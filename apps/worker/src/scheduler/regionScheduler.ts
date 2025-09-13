import cron from "node-cron";
import { listActiveRegions, getRegionByCode, type Region } from "@repo/shared";
import type { Logger } from "../lib/logger.js";
import { mRegionManualRuns, mSchedulerRegionsAdded, mSchedulerRegionsRescheduled, mSchedulerRegionsRemoved, mSchedulerReconcileErrors, mSchedulerRegionsActive, mSchedulerConcurrencyRunning, mSchedulerReconcileLastSuccess } from "../lib/metrics.js";

export type RegionSchedulerOptions = Readonly<{
	refreshIntervalMs?: number;
	concurrency?: number;
}>;

type Scheduled = {
	region: Region;
	task: cron.ScheduledTask;
};

type Handler = (region: Region, logger: Logger) => Promise<void>;

export class RegionScheduler {
	private readonly refreshMs: number;
	private readonly maxConcurrency: number;
	private readonly handler: Handler;
	private readonly logger: Logger;

	private jobs = new Map<string, Scheduled>();
	private refreshTimer?: NodeJS.Timeout;
	private closed = false;
	private running = 0;

	constructor(handler: Handler, opts: RegionSchedulerOptions | undefined, logger: Logger) {
		this.handler = handler;
		this.logger = logger;
		this.refreshMs = Math.max(30_000, Number(opts?.refreshIntervalMs ?? process.env.REGION_REFRESH_INTERVAL_MS ?? 300_000));
		this.maxConcurrency = Math.max(1, Number(opts?.concurrency ?? process.env.CONCURRENCY ?? 4));
	}

	async start(): Promise<void> {
		await this.reconcile();
		this.refreshTimer = setInterval(() => void this.reconcile(), this.refreshMs);
		this.logger.info({ event: "scheduler_started", refreshMs: this.refreshMs, maxConcurrency: this.maxConcurrency });
	}

	async stop(): Promise<void> {
		this.closed = true;
		if (this.refreshTimer) clearInterval(this.refreshTimer);
		for (const { task } of this.jobs.values()) task.stop();
		const count = this.jobs.size;
		this.jobs.clear();
		mSchedulerRegionsActive.set(0);
		this.logger.info({ event: "scheduler_stopped", count });
	}

	private async reconcile(): Promise<void> {
		if (this.closed) return;
		try {
			const regions: Region[] = await listActiveRegions();
			const byId = new Map<string, Region>(regions.map((r): [string, Region] => [r.id, r]));
			let added = 0,
				updated = 0,
				removed = 0;

			// add or update
			for (const region of regions) {
				const current = this.jobs.get(region.id);
				if (!current) {
					this.add(region);
					added++;
					continue;
				}
				if (current.region.cronSchedule !== region.cronSchedule || current.region.active !== region.active) {
					this.replace(region);
					updated++;
				} else {
					current.region = region; // refresh metadata
				}
			}

			// remove stale
			for (const [id, entry] of this.jobs) {
				if (!byId.has(id)) {
					entry.task.stop();
					this.jobs.delete(id);
					removed++;
					mSchedulerRegionsRemoved.inc();
					this.logger.info({ event: "region_removed", region_code: entry.region.code });
				}
			}

			mSchedulerRegionsActive.set(this.jobs.size);
			mSchedulerReconcileLastSuccess.set(Math.floor(Date.now() / 1000));
			this.logger.debug({ event: "reconcile_ok", added, updated, removed, active: this.jobs.size });
		} catch (err) {
			mSchedulerReconcileErrors.inc();
			this.logger.error({ event: "reconcile_error", err }, "reconcile failed");
		}
	}

	private add(region: Region): void {
		if (!region.active) return;
		if (!cron.validate(region.cronSchedule)) {
			this.logger.warn({ event: "invalid_cron", region_code: region.code, cron: region.cronSchedule }, "invalid cronSchedule");
			return;
		}

		const task = cron.schedule(
			region.cronSchedule,
			() => {
				this.dispatch(region).catch((err) => {
					this.logger.error({ event: "region_job_error", region_code: region.code, err }, "region job error");
				});
			},
			{ scheduled: true, timezone: "UTC" }
		);

		task.start();
		this.jobs.set(region.id, { region, task });
		mSchedulerRegionsAdded.inc();
		this.logger.info({ event: "region_added", region_code: region.code, cron: region.cronSchedule }, "scheduled region");
	}

	private replace(region: Region): void {
		const current = this.jobs.get(region.id);
		if (current) {
			current.task.stop();
			this.jobs.delete(region.id);
			mSchedulerRegionsRescheduled.inc();
			this.logger.info({ event: "region_rescheduled", region_code: region.code, cron: region.cronSchedule }, "rescheduled region");
		}
		this.add(region);
	}

	private async dispatch(region: Region): Promise<void> {
		if (this.running >= this.maxConcurrency) {
			this.logger.info({ event: "tick_skipped_capacity", running: this.running, max: this.maxConcurrency, region_code: region.code }, "skipping tick due to concurrency");
			return;
		}

		this.running++;
		mSchedulerConcurrencyRunning.set(this.running);
		const log = this.logger.child({ region_code: region.code });
		try {
			await this.handler(region, log);
		} finally {
			this.running--;
			mSchedulerConcurrencyRunning.set(this.running);
		}
	}

	async runNowByCode(code: string, opts?: { force?: boolean }, log?: Logger): Promise<{ ok: boolean; reason?: string; scheduled?: boolean }> {
		const l = (log ?? this.logger).child({ region_code: code, event: "manual_run" });

		// Fast path: if already scheduled, use that metadata
		const scheduled = this.findScheduledByCode(code);
		let region = scheduled?.region;

		// Otherwise fetch via shared helper; respect 'force' for inactive regions
		if (!region) {
			const includeInactive = !!opts?.force;
			region = await getRegionByCode(code, { includeInactive });
			if (!region) {
				mRegionManualRuns.inc({ result: "rejected", reason: "not_found", region_code: code });
				l.warn({ reason: "not_found" }, "manual run rejected: region not found");
				return { ok: false, reason: "not_found" };
			}
			if (!includeInactive && !region.active) {
				mRegionManualRuns.inc({ result: "rejected", reason: "inactive", region_code: code });
				l.warn({ reason: "inactive" }, "manual run rejected: region inactive");
				return { ok: false, reason: "inactive" };
			}
		}

		if (this.running >= this.maxConcurrency) {
			mRegionManualRuns.inc({ result: "rejected", reason: "capacity", region_code: code });
			l.info({ running: this.running, max: this.maxConcurrency, reason: "capacity" }, "manual run skipped due to capacity");
			return { ok: false, reason: "capacity" };
		}

		try {
			await this.dispatch(region);
			mRegionManualRuns.inc({ result: "accepted", reason: "ok", region_code: code });
			l.info("manual run dispatched");
			return { ok: true, scheduled: true };
		} catch (err) {
			mRegionManualRuns.inc({ result: "error", reason: "exception", region_code: code });
			l.error({ err }, "manual run failed");
			return { ok: false, reason: "error" };
		}
	}

	private findScheduledByCode(code: string): Scheduled | undefined {
		for (const entry of this.jobs.values()) {
			if (entry.region.code === code) return entry;
		}
		return undefined;
	}
}

import { getPrisma, type Region } from "@repo/shared";
import type { Logger } from "../lib/logger.js";
import { mRegionTicks, mRegionTickDuration } from "../lib/metrics.js";

/**
 * The per-region job executed on each cron tick.
 * Extend this to enqueue platform polling / write job_run, etc.
 */
export async function runRegionTick(region: Region, log: Logger): Promise<void> {
	const start = Date.now();
	log.info({ event: "region_tick_start", cron: region.cronSchedule });

	try {
		const prisma = await getPrisma();
		await prisma.$queryRaw`SELECT 1`; // optional keepalive / connectivity check

		// ... TODO: enqueue work / poll APIs ...

		const dur = (Date.now() - start) / 1000;
		mRegionTicks.inc({ result: "ok", region_code: region.code });
		mRegionTickDuration.observe({ region_code: region.code }, dur);
		log.info({ event: "region_tick_end", duration_s: dur });
	} catch (err) {
		const dur = (Date.now() - start) / 1000;
		mRegionTicks.inc({ result: "error", region_code: region.code });
		mRegionTickDuration.observe({ region_code: region.code }, dur);
		log.error({ event: "region_tick_error", duration_s: dur, err }, "tick failed");
		throw err;
	}
}

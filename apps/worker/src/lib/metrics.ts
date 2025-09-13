import http from "node:http";
import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from "prom-client";
import type { Logger } from "./logger.js";

export const registry = new Registry();
collectDefaultMetrics({ register: registry }); // process metrics

// --- Scheduler metrics ---
export const mSchedulerRegionsAdded = new Counter({
	name: "scheduler_regions_added_total",
	help: "Regions added to the scheduler",
});
export const mSchedulerRegionsRescheduled = new Counter({
	name: "scheduler_regions_rescheduled_total",
	help: "Regions rescheduled due to cron changes",
});
export const mSchedulerRegionsRemoved = new Counter({
	name: "scheduler_regions_removed_total",
	help: "Regions removed from the scheduler",
});
export const mSchedulerReconcileErrors = new Counter({
	name: "scheduler_reconcile_errors_total",
	help: "Errors while reconciling scheduler state",
});
export const mSchedulerRegionsActive = new Gauge({
	name: "scheduler_regions_active",
	help: "Number of currently scheduled regions",
});
export const mSchedulerConcurrencyRunning = new Gauge({
	name: "scheduler_concurrency_running",
	help: "Number of region jobs currently running",
});
export const mSchedulerReconcileLastSuccess = new Gauge({
	name: "scheduler_reconcile_last_success_unixtime",
	help: "Unix timestamp of last successful reconcile",
});

// --- Region tick metrics ---
export const mRegionTicks = new Counter({
	name: "region_ticks_total",
	help: "Region tick outcomes",
	labelNames: ["result", "region_code"] as const,
});
export const mRegionTickDuration = new Histogram({
	name: "region_tick_duration_seconds",
	help: "Region tick execution time",
	labelNames: ["region_code"] as const,
	buckets: [0.1, 0.3, 1, 3, 10, 30, 60],
});
export const mRegionManualRuns = new Counter({
	name: "region_manual_runs_total",
	help: "Manual trigger attempts for region ticks",
	labelNames: ["result", "reason", "region_code"] as const, // result: accepted|rejected|error
});

export function startMetricsServer(opts?: { port?: number; host?: string; logger?: Logger }) {
	const port = Number(opts?.port ?? process.env.METRICS_PORT ?? 9091);
	const host = String(opts?.host ?? "0.0.0.0");
	const log = opts?.logger;

	const srv = http.createServer(async (req, res) => {
		if (req.url === "/metrics") {
			try {
				const body = await registry.metrics();
				res.setHeader("Content-Type", registry.contentType);
				res.writeHead(200);
				res.end(body);
			} catch (e) {
				res.writeHead(500);
				res.end(String(e));
			}
			return;
		}
		if (req.url === "/healthz") {
			res.writeHead(200);
			res.end("ok");
			return;
		}
		res.writeHead(404);
		res.end("not found");
	});

	srv.listen(port, host, () => {
		log?.info({ event: "metrics_listen", port, host }, "metrics server listening");
	});

	return srv;
}

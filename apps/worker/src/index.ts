import { randomUUID } from "node:crypto";
import { RegionScheduler } from "./scheduler/regionScheduler.js";
import { runRegionTick } from "./jobs/regionTick.js";
import { logger } from "./lib/logger.js";
import { startMetricsServer } from "./lib/metrics.js";
import { startApiServer } from "./http/apiServer.js";
import { getPrisma } from "@repo/shared";

async function main(): Promise<void> {
	const runId = randomUUID();
	const log = logger.child({ run_id: runId });

	const metricsSrv = startMetricsServer({ logger: log });

	const scheduler = new RegionScheduler(
		runRegionTick,
		{
			refreshIntervalMs: Number(process.env.REGION_REFRESH_INTERVAL_MS ?? 300_000),
			concurrency: Number(process.env.CONCURRENCY ?? 4),
		},
		log
	);
	await scheduler.start();

	const apiSrv = startApiServer({
		scheduler,
		logger: log,
		port: Number(process.env.API_PORT ?? 8080),
		host: "0.0.0.0",
		token: process.env.WORKER_API_TOKEN ?? null,
	});

	const shutdown = async (sig: string) => {
		log.info({ event: "shutdown", signal: sig });

		await scheduler.stop();

		try {
			const prisma = await getPrisma();
			await prisma.$disconnect();
		} catch {}

		metricsSrv.close(() => log.info({ event: "metrics_closed" }));
		apiSrv.close(() => log.info({ event: "api_closed" }));

		setTimeout(() => process.exit(0), 200).unref();
	};

	process.once("SIGINT", () => void shutdown("SIGINT"));
	process.once("SIGTERM", () => void shutdown("SIGTERM"));
	process.once("beforeExit", () => void shutdown("beforeExit"));
}

main().catch((err: unknown) => {
	logger.error({ event: "unhandled", err }, "fatal");
	process.exit(1);
});

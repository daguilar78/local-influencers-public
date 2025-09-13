import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

function buildLogger() {
	// Common options
	const baseOpts = {
		level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
		base: {
			service: "worker",
			env: process.env.NODE_ENV ?? "development",
			version: process.env.npm_package_version,
		},
		timestamp: pino.stdTimeFunctions.isoTime,
	} as const;

	// In dev, pretty-print via transport passed as 2nd arg
	if (!isProd) {
		try {
			const transport = pino.transport({
				target: "pino-pretty",
				options: {
					colorize: true,
					singleLine: true,
					translateTime: "SYS:standard",
				},
			});
			return pino(baseOpts, transport);
		} catch {
			// pino-pretty not installed or failed – fall back to JSON
		}
	}

	// Prod (or dev fallback): JSON to stdout
	return pino(baseOpts);
}

export const logger = buildLogger();
export type Logger = typeof logger;

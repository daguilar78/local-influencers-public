import http from "node:http";
import { URL } from "node:url";
import type { RegionScheduler } from "../scheduler/regionScheduler.js";
import type { Logger } from "../lib/logger.js";

export type ApiServerOpts = Readonly<{
	port?: number;
	host?: string;
	token?: string | null;
	scheduler: RegionScheduler;
	logger: Logger;
}>;

export function startApiServer(opts: ApiServerOpts) {
	const port = Number(opts.port ?? process.env.API_PORT ?? 8080);
	const host = String(opts.host ?? "0.0.0.0");
	const token = opts.token ?? process.env.WORKER_API_TOKEN ?? null;
	const log = opts.logger.child({ component: "api" });
	const scheduler = opts.scheduler;

	const srv = http.createServer(async (req, res) => {
		try {
			const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
			const path = u.pathname;

			// Health
			if (req.method === "GET" && path === "/healthz") {
				res.writeHead(200).end("ok");
				return;
			}

			// Auth if token configured
			if (token) {
				const auth = req.headers["authorization"];
				if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== token) {
					res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
					return;
				}
			}

			// Manual run: GET /run?code=DETROIT_METRO&force=1  or POST /run { code, force }
			if ((req.method === "GET" || req.method === "POST") && path === "/run") {
				let code: string | undefined;
				let force = false;

				if (req.method === "GET") {
					code = u.searchParams.get("code") ?? undefined;
					force = u.searchParams.get("force") === "1" || u.searchParams.get("force") === "true";
				} else {
					const body = await readJsonBody(req);
					code = typeof body?.code === "string" ? body.code : undefined;
					force = body?.force === true || body?.force === "1";
				}

				if (!code) {
					res.writeHead(400).end(JSON.stringify({ error: "missing code" }));
					return;
				}

				const result = await scheduler.runNowByCode(code, { force }, log);
				if (result.ok) {
					res.writeHead(202).end(JSON.stringify({ ok: true, code, force, status: "dispatched" }));
				} else {
					const map: Record<string, number> = { not_found: 404, inactive: 409, capacity: 429, error: 500 };
					res.writeHead(map[result.reason ?? "error"] ?? 500).end(JSON.stringify({ ok: false, code, reason: result.reason }));
				}
				return;
			}

			// 404
			res.writeHead(404).end(JSON.stringify({ error: "not_found" }));
		} catch (err) {
			log.error({ err }, "api error");
			res.writeHead(500).end(JSON.stringify({ error: "internal" }));
		}
	});

	srv.listen(port, host, () => {
		log.info({ event: "api_listen", host, port }, "api server listening");
	});

	return srv;
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
		req.on("end", () => {
			if (chunks.length === 0) return resolve({});
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});
}

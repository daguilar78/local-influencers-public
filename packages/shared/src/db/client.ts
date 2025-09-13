import type { PrismaClient, Prisma } from "@prisma/client";

let _prisma: PrismaClient | undefined;

function addPgbouncerTrue(url: string): string {
	try {
		const u = new URL(url);
		u.searchParams.set("pgbouncer", "true");
		return u.toString();
	} catch {
		const hasQuery = url.includes("?");
		const hasParam = /(?:[?&])pgbouncer=/.test(url);
		if (hasParam) return url.replace(/([?&]pgbouncer=)[^&]*/i, "$1true");
		return `${url}${hasQuery ? "&" : "?"}pgbouncer=true`;
	}
}

export async function getPrisma(): Promise<PrismaClient> {
	if (_prisma) return _prisma;

	try {
		const { PrismaClient } = await import("@prisma/client");

		const isProd = (process.env.NODE_ENV ?? "development") === "production";
		const rawUrl = process.env.DATABASE_URL;

		// Only set datasources in dev; omit the property entirely otherwise.
		const ds: Prisma.Datasources | undefined = !isProd && rawUrl ? { db: { url: addPgbouncerTrue(rawUrl) } } : undefined;

		const options: Prisma.PrismaClientOptions = {
			log: ["error", "warn"],
			...(ds && { datasources: ds }), // ← omit when undefined (fixes exactOptionalPropertyTypes)
		};

		_prisma = new PrismaClient(options);
		return _prisma;
	} catch (e) {
		const { createRequire } = await import("node:module");
		const r = createRequire(import.meta.url);
		let resolved = "not found";
		try {
			resolved = r.resolve("@prisma/client");
		} catch {}
		const msg = (e as Error).message ?? String(e);
		throw new Error(`${msg} (resolved: ${resolved})`);
	}
}

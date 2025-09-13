import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type RegionSeed = Readonly<{
	code: string;
	name: string;
	minLng: Prisma.Decimal;
	minLat: Prisma.Decimal;
	maxLng: Prisma.Decimal;
	maxLat: Prisma.Decimal;
	cronSchedule: string; // 5-field cron (UTC)
	active?: boolean;
}>;

// Seed regions (bbox approx; UTC schedules)
const REGIONS: readonly RegionSeed[] = [
	{
		code: "DETROIT_METRO",
		name: "Detroit Metro",
		minLng: new Prisma.Decimal(-83.7),
		minLat: new Prisma.Decimal(42.1),
		maxLng: new Prisma.Decimal(-82.7),
		maxLat: new Prisma.Decimal(42.75),
		// daily at 03:00 UTC
		cronSchedule: "0 3 * * *",
		active: true,
	},
	{
		code: "LOSANGELES_METRO",
		name: "Los Angeles Metro",
		minLng: new Prisma.Decimal(-118.9),
		minLat: new Prisma.Decimal(33.6),
		maxLng: new Prisma.Decimal(-117.5),
		maxLat: new Prisma.Decimal(34.4),
		// every 12 hours
		cronSchedule: "0 */12 * * *",
		active: true,
	},
];

async function main(): Promise<void> {
	for (const r of REGIONS) {
		const row = await prisma.region_index.upsert({
			where: { code: r.code },
			update: {
				name: r.name,
				minLng: r.minLng,
				minLat: r.minLat,
				maxLng: r.maxLng,
				maxLat: r.maxLat,
				cronSchedule: r.cronSchedule,
				active: r.active ?? true,
			},
			create: {
				code: r.code,
				name: r.name,
				minLng: r.minLng,
				minLat: r.minLat,
				maxLng: r.maxLng,
				maxLat: r.maxLat,
				cronSchedule: r.cronSchedule,
				active: r.active ?? true,
			},
		});

		// eslint-disable-next-line no-console
		console.log(JSON.stringify({ event: "region_seeded", code: row.code, id: row.id, cron: row.cronSchedule }, null, 0));
	}
}

main()
	.catch((e) => {
		console.error(JSON.stringify({ level: "error", event: "seed_failed", message: (e as Error).message }));
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});

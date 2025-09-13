import { getPrisma } from "./client.js";
import type { Decimal } from "@prisma/client/runtime/library";

export type Region = Readonly<{
	id: string;
	code: string;
	name: string;
	bbox: Readonly<{
		minLng: number;
		minLat: number;
		maxLng: number;
		maxLat: number;
	}>;
	cronSchedule: string; // ← cron instead of hours
	active: boolean;
	createdAt: string; // ISO
	updatedAt: string; // ISO
}>;

const regionSelect = {
	id: true,
	code: true,
	name: true,
	minLng: true,
	minLat: true,
	maxLng: true,
	maxLat: true,
	cronSchedule: true, // ← new field
	active: true,
	createdAt: true,
	updatedAt: true,
} as const;

type RowSelected = Readonly<{
	id: string;
	code: string;
	name: string;
	minLng: Decimal;
	minLat: Decimal;
	maxLng: Decimal;
	maxLat: Decimal;
	cronSchedule: string;
	active: boolean;
	createdAt: Date;
	updatedAt: Date;
}>;

const d2n = (d: Decimal): number => d.toNumber();

const mapRow = (r: RowSelected): Region => ({
	id: r.id,
	code: r.code,
	name: r.name,
	bbox: {
		minLng: d2n(r.minLng),
		minLat: d2n(r.minLat),
		maxLng: d2n(r.maxLng),
		maxLat: d2n(r.maxLat),
	},
	cronSchedule: r.cronSchedule,
	active: r.active,
	createdAt: r.createdAt.toISOString(),
	updatedAt: r.updatedAt.toISOString(),
});

export async function listActiveRegions(): Promise<Region[]> {
	const prisma = await getPrisma();
	const rows = await prisma.region_index.findMany({
		where: { active: true },
		orderBy: { code: "asc" },
		select: regionSelect,
	});
	return (rows as readonly RowSelected[]).map(mapRow);
}

export async function getRegionByCode(code: string, opts?: { includeInactive?: boolean }): Promise<Region | undefined> {
	const prisma = await getPrisma();
	const where = opts?.includeInactive ? { code } : { code, active: true };
	const row = await prisma.region_index.findFirst({
		where,
		select: regionSelect,
	});
	return row ? mapRow(row as RowSelected) : undefined;
}

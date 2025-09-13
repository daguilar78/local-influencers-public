import parser from "cron-parser";

/** Compute the next N run times (UTC ISO strings) for a cron string. */
export function nextRuns(cron: string, count: number, from: Date = new Date()): string[] {
	const it = parser.parseExpression(cron, { currentDate: from, tz: "UTC" });
	const out: string[] = [];
	for (let i = 0; i < Math.max(0, count); i++) out.push(it.next().toISOString());
	return out;
}

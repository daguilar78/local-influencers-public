import { listActiveRegions, type Region, nextRuns } from "@repo/shared";

export const runtime = "nodejs"; // Prisma requires Node (not Edge)
export const dynamic = "force-dynamic"; // avoid build-time DB calls

export default async function HomePage() {
	let regions: Region[] = [];
	let error: string | null = null;

	try {
		regions = await listActiveRegions();
	} catch (e) {
		error = (e as Error).message;
	}

	return (
		<section className="space-y-6">
			<div>
				<h2 className="text-xl font-semibold">Active Regions</h2>
				{error ? (
					<p className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700">Failed to load regions: {error}</p>
				) : regions.length === 0 ? (
					<p className="mt-2 text-sm text-neutral-600">No active regions found.</p>
				) : (
					<ul className="mt-4 divide-y rounded-xl border">
						{regions.map((r) => (
							<li key={r.id} className="p-4">
								<div className="flex items-center justify-between">
									<div>
										<div className="font-medium">{r.code}</div>
										<div className="text-sm text-neutral-600">{r.name}</div>
										<div className="mt-1 text-xs text-neutral-500">
											cron: <code>{r.cronSchedule}</code>
											<span className="ml-2">next: {nextRuns(r.cronSchedule, 1)[0] ?? "—"}</span>
										</div>
									</div>
									<div className="text-xs text-neutral-500">
										[{r.bbox.minLng.toFixed(3)}, {r.bbox.minLat.toFixed(3)}] → [{r.bbox.maxLng.toFixed(3)}, {r.bbox.maxLat.toFixed(3)}]
									</div>
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

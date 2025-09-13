# Overview

-   **Entry:** apps/worker/src/index.ts

-   **Scheduler:** apps/worker/src/scheduler/regionScheduler.ts

-   **Per-tick job:** apps/worker/src/jobs/regionTick.ts

-   **DB access (shared):** packages/shared/src/db/regions.ts + packages/shared/src/db/client.ts

-   **Cron engine:** node-cron (UTC)

## Process start → bootstrap

1. **Node starts** dist/index.js (prod) or tsx watch src/index.ts (dev).

2. index.ts constructs a **RegionScheduler** with:

    - handler: runRegionTick(region)

    - refreshIntervalMs: how often to re-read regions (default 5 min)

    - concurrency: max parallel region jobs (default 4)

3. scheduler.start():

    - Calls reconcile() once immediately.

    - Sets a setInterval to call reconcile() every refreshIntervalMs.

## Reconcile: read DB → align cron tasks

RegionScheduler.reconcile() is the heart of “declare desired state vs. actual”:

1. Calls listActiveRegions() from shared:

    - listActiveRegions() uses getPrisma() to obtain a lazy Prisma client.

    - Query: region_index.findMany({ where: {active: true}, orderBy: {code: "asc"}, select: {…} }).

    - Mapper converts DECIMAL to number and Date to ISO strings, returns Region[].

2. Builds an in-memory Map<string, Region> (id → region) for fast diffing.

3. Add/update: For each active region from DB:

    - If no existing task, call add(region):

        - Validates cron string via node-cron.validate.

        - Creates a cron.schedule(region.cronSchedule, callback, { timezone:"UTC" }).

        - Stores { region, task } in jobs: Map<id, Scheduled>.

    - If a task exists but cron changed or active state differs, call replace(region):

        - Stops the old task, removes it, then calls add(region) again.

    - If unchanged, refresh the stored region metadata (name/bbox/etc.).

4. Remove: any scheduled jobs whose region no longer exists or is inactive are stopped and removed from the map.

This makes the worker eventually consistent with DB config without restarts. You can edit cronSchedule or active in the DB and the process will pick it up within refreshIntervalMs.

## Cron tick → bounded dispatch

For each scheduled region job:

1. node-cron fires the callback on its UTC schedule.

2. The scheduler’s dispatch(region) enforces concurrency:

    - If running >= maxConcurrency, it logs and skips this tick (backpressure).

    - Else increments running, awaits the handler, and decrements in finally.

This keeps you from stampeding external APIs or the DB when many regions align on the same minute.

## The region job handler (runRegionTick)

apps/worker/src/jobs/regionTick.ts is your per-tick “do work here” hook:

1. Acquires Prisma via shared getPrisma() (lazy singleton).

2. (Optional) Pokes the DB or writes to job_run; currently you do a harmless SELECT 1 as a keepalive.

3. Logs a structured event with region.code, cron, and timestamp.

This is exactly where you’ll add:

-   Platform-specific polling (YouTube, TikTok, etc.)

-   ETag/If-None-Match handling

-   Queuing (e.g., enqueue granular fetch tasks into a durable queue)

-   Metrics and job_run writes

## Prisma client lifecycle (dev-safe)

packages/shared/src/db/client.ts manages a singleton Prisma client with dev patches:

-   Lazy import: await import('@prisma/client') only when a DB function is first used.

-   Dev PgBouncer mode: When NODE_ENV !== 'production' and DATABASE_URL is set, it appends pgbouncer=true to the URL (via datasources) so Prisma uses simple-protocol (no prepared statements). This prevents the dreaded "prepared statement \"s0\" already exists" on fast restarts in watch mode.

-   Global cache in dev: The client instance is stored on globalThis to survive module reloads during hot dev (tsx watch). This reduces connection churn.

-   Graceful disconnect: On shutdown (see below), the worker calls prisma.$disconnect() to cleanly drop connections.

## Errors and logging

-   Scheduler add/replace/remove prints concise messages (added schedule, rescheduled, removed).

-   Cron callback wraps the job handler with a try/catch and logs structured JSON on errors.

-   The top-level index.ts wraps main() in a catch and fatals with a structured error.

Nothing is retried automatically yet (beyond cron firing again). A typical next step is to catch transient API errors and requeue with exponential backoff.

## Shutdown (SIGINT/SIGTERM/beforeExit)

When you Ctrl+C or the platform sends SIGTERM:

1. index.ts traps the signal with process.once(...).

2. Calls scheduler.stop():

    - Clears the reconcile setInterval.

    - Stops every node-cron task.

    - Empties the jobs map.

3. Calls getPrisma() and prisma.$disconnect() to close DB connections.

4. Schedules a short setTimeout(...).unref() failsafe to exit even if something hangs.

Because the Prisma client may live on a pooled backend (PgBouncer/managed PG), disconnecting prevents “dangling” prepared statements from persisting on a backend you might land on next run.

## Configuration knobs (env or ctor)

-   **REGION_REFRESH_INTERVAL_MS** — how often the scheduler re-reads regions (default 300 000 ms).

-   **CONCURRENCY** — max concurrent region tasks (default 4).

-   **DATABASE_URL** — Postgres. In dev, the client appends pgbouncer=true in-process; in prod you can omit that (or include it if you actually run PgBouncer in transaction mode).

-   **NODE_ENV** — dev vs prod behavior for the Prisma URL patch & global caching.

## Failure modes & how they’re handled

-   Invalid cron strings: scheduler logs a warning and does not schedule that region until fixed in DB.

-   DB unavailable on reconcile: reconcile throws; the setInterval will try again on the next tick. You could wrap reconcile() in a try/catch if you want to suppress logs each time.

-   Concurrent spikes: capped by maxConcurrency; excess ticks are skipped, not queued (by design). If you want guaranteed execution, integrate a queue (e.g., Redis) and push tick events into it.

-   Hot dev restarts (prepared statements): mitigated by programmatic pgbouncer=true + $disconnect() on shutdown.

## Typical production hardening (ready when you are)

-   Exactly-once per region/tick: Use a distributed lock (Postgres advisory lock or Redis SET NX PX) keyed by {regionId,timestampMinute} to prevent two replicas from running the same tick.

-   Job audit: Insert a job_run row at start; update with ok and timings at finish. Capture the effective cron and any fetch window used.

-   Backoff & retries: Wrap platform calls with exponential backoff + jitter and classify status codes for retry vs. fail.

-   Metrics/alerts: Emit counters (regions scheduled, ticks run, ticks skipped, job errors) and latencies; alert on error rate spikes or long stalls.

-   ETag/If-Modified-Since: Store etag on creator and use conditional requests to minimize API quotas.

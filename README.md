# Local Influencers — Monorepo

A typed, production‑ready monorepo for discovering and tracking local creators across social platforms. Built around **Next.js**, a **TypeScript worker**, and **Prisma + Postgres**. Both apps import **only** the shared library; Prisma client ownership is **per‑app**.

---

## Contents

-   [Stack](#stack)
-   [Workspace layout](#workspace-layout)
-   [Prereqs](#prereqs)
-   [Quick start](#quick-start)
-   [Environment](#environment)
-   [Database & Prisma](#database--prisma)
-   [Seeding](#seeding)
-   [Apps](#apps)
    -   [Web (Next.js)](#web-nextjs)
    -   [Worker](#worker)
-   [Shared package](#shared-package)
-   [DB package](#db-package)
-   [Scheduling model](#scheduling-model)
-   [Build & deploy](#build--deploy)
-   [Security & compliance](#security--compliance)
-   [Testing & observability](#testing--observability)
-   [Troubleshooting](#troubleshooting)
-   [Contributing](#contributing)

---

## Stack

-   **Package manager:** pnpm (workspaces)
-   **Language:** TypeScript (strict, NodeNext)
-   **Web:** Next.js + Tailwind (Vercel‑ready)
-   **Worker:** Node 22 TypeScript app (Fly.io‑ready)
-   **ORM/DB:** Prisma + PostgreSQL
-   **Cache/Queue (future):** Redis (planned)
-   **Scheduling:** `node-cron` (UTC)
-   **Infra notes:** ETag/If‑Modified‑Since, backoff+jitter, queues/workers split, structured logs

---

## Workspace layout

```
.
├─ apps/
│  ├─ web/            # Next.js app
│  └─ worker/         # TS worker service
├─ packages/
│  ├─ shared/         # Shared code (API‑facing facade for apps)
│  └─ db/             # Prisma schema, migrations, seeding
├─ tsconfig.base.json
├─ pnpm-workspace.yaml
└─ package.json
```

**Rule:** apps import **only** `@repo/shared`. Each app **owns** its own `@prisma/client` runtime and runs `prisma generate` against `packages/db/prisma/schema.prisma`.

---

## Prereqs

-   Node **>= 20** (recommended 22)
-   pnpm via Corepack:
    ```bash
    corepack enable
    corepack prepare pnpm@9.15.4 --activate
    ```
-   PostgreSQL database for dev/stage/prod

---

## Quick start

```bash
# 0) First install
pnpm install

# 1) Generate Prisma clients (per app)
pnpm -F web run prisma:generate
pnpm -F worker run prisma:generate

# 2) Migrate the dev DB (creates tables)
export DATABASE_URL="postgresql://user:pass@host:5432/db"
pnpm -F @repo/db exec prisma migrate dev

# 3) (Optional) Seed initial regions
pnpm -F @repo/db run seed

# 4) Dev servers
pnpm -C apps/web dev            # http://localhost:3000
pnpm -C apps/worker dev         # worker with hot‑reload

# 5) Build all
pnpm -r build

# 6) Start worker (compiled)
pnpm -F worker start
```

---

## Environment

Create `.env` files per app or export environment variables:

-   `DATABASE_URL` — Postgres connection string
-   **Dev ergonomics** (recommended):
    -   `PRISMA_DISABLE_PREPARED_STATEMENTS=true` _or_ append `?pgbouncer=true` to `DATABASE_URL`
    -   The shared Prisma client already appends `pgbouncer=true` in **dev** via `datasources`, ensuring simple protocol.

---

## Database & Prisma

-   Schema lives in `packages/db/prisma/schema.prisma` (see models `creator`, `influencer`, `region_index`, etc.).
-   **Cron‑based refresh:** `region_index.cronSchedule` holds a 5‑field UTC cron string (e.g., `0 3 * * *`).
-   **Migrations:** managed via `@repo/db`.
    ```bash
    pnpm -F @repo/db exec prisma migrate dev --name <change>
    pnpm -F @repo/db exec prisma migrate deploy           # CI/prod
    ```
-   **Client generation:** per app (web & worker). Don’t override generator `output` in the schema.

---

## Seeding

We provide a typed Prisma seed that inserts two seed regions:

```bash
# seed (dev)
export DATABASE_URL=postgres://...
pnpm -F @repo/db run seed
```

-   DETROIT_METRO → `0 3 * * *` (daily 03:00 UTC)
-   LOSANGELES_METRO → `0 */12 * * *` (every 12 hours)

---

## Apps

### Web (Next.js)

-   Renders a list of active regions using `@repo/shared`.
-   Server components execute DB calls at request time.
-   Build:
    ```bash
    pnpm -F web build
    ```
-   Dev:
    ```bash
    pnpm -C apps/web dev
    ```

**Note:** Next config is ESM (`next.config.mjs`) and marks `@prisma/client` as external for server components.

### Worker

-   Periodically pulls `region_index` and spins cron jobs per region.
-   Concurrency‑bound execution; logs structured JSON.
-   Live reconcile (add/update/remove) without restart.
-   Dev (hot reload):
    ```bash
    pnpm -C apps/worker dev
    ```
-   Build/start:
    ```bash
    pnpm -F worker build
    pnpm -F worker start
    ```

**Graceful shutdown:** stops cron tasks, disconnects Prisma, and exits.

---

## Shared package

Exports the minimal, strongly‑typed surface the apps use:

-   `listActiveRegions(): Promise<Region[]>`
-   `getPrisma()` — lazy, dev‑safe Prisma client
-   `nextRuns(cron, n)` — optional helper for previewing schedules
-   `SHARED_INFO` — sample export

**Implementation details:**

-   Uses **NodeNext** module resolution with explicit `.js` extensions in relative imports (ESM‑safe).
-   In **dev**, `getPrisma()` appends `pgbouncer=true` via `datasources` to avoid prepared‑statement issues.

---

## DB package

-   Holds the Prisma schema and migrations.
-   Provides `prisma db seed` and migration scripts.
-   No TypeScript build output is shipped from this package (no `build` script needed).

---

## Scheduling model

-   Regions have `cronSchedule` (UTC).
-   The worker validates cron strings with `node-cron`; invalid entries are skipped with a warning.
-   `RegionScheduler`:
    -   `reconcile()` on start and every `REGION_REFRESH_INTERVAL_MS` (default 5m).
    -   Creates/updates/removes `node-cron` tasks for each region.
    -   Caps parallel executions with `CONCURRENCY` (default 4).
-   `runRegionTick(region)` is where platform polling/queuing will live.

---

## Build & deploy

### Vercel (web)

-   Monorepo detection picks up `apps/web`.
-   Ensure `DATABASE_URL` is set in Vercel env.
-   On install/build, web runs `prisma generate` and Next builds server bundles.

### Fly.io (worker)

-   Dockerfile builds TypeScript with dev deps in the build stage, then ships a pruned production app.
-   Ensure `DATABASE_URL` is set:
    ```bash
    flyctl secrets set DATABASE_URL=postgres://...
    flyctl deploy -c apps/worker/fly.toml
    ```

---

## Security & compliance

-   **Official APIs only** (no scraping). Respect ToS, app review, and user consent.
-   **PII minimization:** avoid storing emails/phones; prefer links/forms in `contactUrl`.
-   **Secrets:** use env vars and platform secret stores; never commit.
-   **Data retention:** keep only what’s needed; document TTLs.
-   **Multi‑tenant:** add tenant scoping if/when needed (RLS in PG recommended).

---

## Testing & observability

-   **Unit/integration:** add test targets per package (Vitest/Jest).
-   **Contract tests:** mock 3rd‑party APIs; record schema for stability.
-   **Logs:** structured JSON for worker; capture `event`, `region`, timings.
-   **Metrics:** add counters (ticks run/skipped, errors), latency histograms.
-   **Dashboards:** region tick success rate, lag vs. schedule, API quota usage.
-   **Alerts:** error rate spikes, missing ticks, long runtimes.

---

## Troubleshooting

-   **“@prisma/client did not initialize yet”**  
    Run `pnpm -F web prisma:generate` and `pnpm -F worker prisma:generate`.  
    Ensure you **did not** set a custom `output` in `generator client` pointing to the wrong package.

-   **Dev: “prepared statement 's0' already exists”**  
    The shared Prisma client appends `pgbouncer=true` in dev. Also OK: set `PRISMA_DISABLE_PREPARED_STATEMENTS=true` or add `?pgbouncer=true` to `DATABASE_URL` in dev.

-   **ESM import errors (`ERR_MODULE_NOT_FOUND`)**  
    All relative imports in shared must include `.js` (compiled ESM). Rebuild `@repo/shared` before building apps.

-   **TypeScript TS5110 (NodeNext)**  
    Use `"module": "NodeNext"` with `"moduleResolution": "NodeNext"` in Node apps.

---

## Contributing

-   **Branching:** `feat/*`, `fix/*`, `chore/*`
-   **Commits:** conventional messages preferred
-   **Code style:** strict TS, no implicit any, prefer explicit return types
-   **PR checks:** build, typecheck, (future) tests & lint

---

### Roadmap (next)

-   Add job ledger (`job_run`) writes on start/finish with status + timings.
-   Platform integrations with rate‑limit aware polling and ETag caching.
-   Redis queue + worker pool for per‑creator fetch tasks.
-   Metrics (OpenTelemetry / Prometheus) and basic alerting.

# syntax=docker/dockerfile:1.6

# ---------- Build stage ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# dev deps needed for TS build & prisma generate
ENV NODE_ENV=development

# Cache-friendly: copy manifests
COPY package.json tsconfig.base.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/worker/package.json apps/worker/package.json

# Pre-fetch
RUN pnpm fetch

# Bring sources
COPY packages ./packages
COPY apps/worker ./apps/worker

# Install with dev deps for selected workspaces
RUN pnpm -r --filter @repo/shared --filter @repo/db --filter worker install --offline --frozen-lockfile --prod=false

# Generate Prisma client for the worker (schema lives in packages/db)
RUN pnpm --filter worker exec prisma generate --schema=../../packages/db/prisma/schema.prisma

# Build TS (shared + worker)
RUN pnpm -r --filter @repo/shared --filter worker build

# Create pruned prod deploy dir incl. workspace deps (shared) + node_modules
RUN pnpm deploy --filter worker --prod /app/deploy

# ---------- Runtime stage ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# copy pruned app with node_modules & compiled dist
COPY --from=build /app/deploy ./

CMD ["node", "apps/worker/dist/index.js"]

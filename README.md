# blaze

Any database in 200ms. Free, agent-native, six engines.

Managed PostgreSQL, MySQL, MariaDB, MongoDB, Redis and libSQL, provisioned from a REST
API, an MCP server, or the dashboard. Runs on a single Dokploy VPS.

**[PLAN.md](./PLAN.md) is the source of truth** for what blaze is and why it is built this
way. Read it before changing anything architectural — most of the non-obvious decisions
(shared clusters, hostname-only connection strings, why Redis gets its own container) have
a reason recorded there.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 4 · Bun · Drizzle + Postgres · Clerk · Biome

## Getting started

```bash
bun install
cp .env.example .env.local     # then fill it in
openssl rand -hex 32           # -> ENCRYPTION_KEY
bun run db:migrate
bun dev
```

## Local SQL engines

`docker-compose.dev.yaml` runs a local control-plane Postgres plus one instance of every
SQL engine (Postgres 18, MySQL 8, MariaDB 11, libSQL), each holding a seeded shop database
(customers, products, orders, order items — foreign keys, indexes, a JSON column, NULLs,
~1.2k orders) owned by an unprivileged tenant role, the same shape a real tenant gets.

```bash
docker compose -f docker-compose.dev.yaml up -d
# Applies migrations to the *local* control DB, seeds every engine, and registers one
# database per engine for that Clerk (development instance) user.
bun run dev:seed -- --email you+clerk_test@example.com
```

Then start the app against the local control DB, with the dev-only tenant redirect:

```bash
DATABASE_URL=postgresql://blaze:blaze@127.0.0.1:54320/blaze \
TENANT_HOST_OVERRIDE=127.0.0.1 \
TENANT_PORT_OVERRIDE=postgres=54321,mysql=33061,mariadb=33062,libsql=58080 \
bun dev
```

Process environment wins over `.env.local`, so this never touches a remote control DB.
The seeded instance rows keep production-shaped hosts (`blaze-dev-postgres:5433`);
`TENANT_HOST_OVERRIDE` / `TENANT_PORT_OVERRIDE` are what point them at the containers, and
both are ignored when `NODE_ENV=production` (see `lib/dev-override.ts`). To point any other
database record at a local engine, give its instance the engine's default port and add that
engine to `TENANT_PORT_OVERRIDE`.

The SQL console's "Ask Claude" assistant needs `ANTHROPIC_API_KEY`; without it the panel
says so and everything else works. To exercise it without a key or any spend, run
`bun e2e/mock-anthropic.ts` and start the app with `ANTHROPIC_API_KEY=test` and
`ANTHROPIC_BASE_URL=http://127.0.0.1:4011`. `e2e/sql-console.mjs` drives the whole console
against these engines.

`docker compose -f docker-compose.dev.yaml down -v` throws everything away; re-run
`dev:seed` to start over (it is idempotent anyway).

## Layout

```
app/                  routes — marketing, dashboard, /v1 API
lib/
  control/            blaze's own database: schema + client
  engines/            the six tenant drivers, and ENGINE_CONFIG (tenancy lives here)
  dokploy/            container lifecycle, dedicated engines only
  connection.ts       builds tenant connection strings — hostnames, never IPs
  crypto.ts           AES-GCM for tenant passwords, SHA-256 for API keys
  limits.ts           free-tier quotas
drizzle/              generated migrations
```

## Two invariants worth knowing

**Connection strings never contain an IP address.** They are permanent once a customer
pastes one into production, so every database is addressed through DNS we control
(`pg.blaze.run`). This is what makes adding a node or moving a container a config change
rather than a breaking change. `lib/connection.ts` is the only place they are built.

**Tenant passwords are encrypted, API keys are hashed.** Passwords have to round-trip
because the dashboard renders a working connection string; API keys never do.

## Scripts

```bash
bun dev            bun run build       bun run lint       bun run test
bun run dev:seed
bun run db:generate   db:migrate   db:push   db:studio
```

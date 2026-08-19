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
bun dev            bun run build       bun run lint
bun run db:generate   db:migrate   db:push   db:studio
```

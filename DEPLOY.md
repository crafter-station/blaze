# Deployment

Live on the Crafter VPS (`95.111.248.246`) under the Dokploy project **blaze**.

**Verified** (via `--resolve`, since DNS does not exist yet):

| Check | Result |
|---|---|
| `GET /api/health` | `200 {"status":"ok"}` — includes a real `select 1` against the control plane |
| `GET /` | `200`, landing page renders |
| `GET /sign-in` | `200`, Clerk renders |
| `GET /projects` | `307` — `proxy.ts` is enforcing auth |

## Build notes

The build runs under **Node, not Bun**. Bun cannot build this app: Next 16's Turbopack
production build fails under Bun's runtime while collecting page data
(`Expected CommonJS module to have a function wrapper`), and then segfaults on exit.
Reproduced on Bun 1.3.14 and 1.2.23. Bun still does `bun install` and owns `bun.lock`.

Secrets are **not** build args. `lib/env.ts` and `lib/control/db.ts` validate and connect
lazily so `next build` — which imports every route module — does not need runtime secrets.
Only `NEXT_PUBLIC_*` is passed at build time, because Next inlines it into the client
bundle.

## What exists

| Resource | Dokploy id | Address | Purpose |
|---|---|---|---|
| Project `blaze` | `8K4aj2NG2-YPucX29GHnp` | — | Groups everything below |
| `blaze-control` (Postgres 18.6) | `LCNArJw_qgpC_AUzJyz1Y` | `blaze-control-novevz:5432` | blaze's own control plane |
| `blaze-pg-1` (Postgres 18.6) | `-bDOO3017h10cYnF_e-sV` | `blaze-pg-1-yu7lyz:5432` | Shared tenant instance #1 |
| `blaze-web` (Next.js) | `0mGYJlp33YxrZPsetlDqi` | `blaze.crafter.run` | Dashboard, `/v1`, MCP |

Repo: `crafter-station/blaze` (private), deployed from `main` via the
`dokploy-2026-04-22-crafter` GitHub App, Dockerfile build, auto-deploy on push.

Control-plane rows seeded by `scripts/bootstrap-instance.ts`:
node `crafter-vps-1`, instance `inst_8pegf94t2v32` (postgres, shared, active).

Clerk application **blaze** — `app_3I8oWtsm6d0SQ4xZqmvOtqX27hS`, currently the
**development** instance. Keys live in Dokploy env and in local `.env.local`.

## DNS — done

Created with the `crafters` CLI against Spaceship DNS, following the `sponsors.crafter.run`
pattern (CNAME → `vps.crafter.run`, itself an A record to the VPS):

```bash
crafters domain add blaze    --target vps.crafter.run
crafters domain add pg.blaze --target vps.crafter.run
```

Note the `--ip` flag shown in the `vps` skill does not exist in `crafters` 0.3.2; use
`--target` instead.

Traefik had already cached an ACME failure from before the records existed and was serving
`TRAEFIK DEFAULT CERT`. Removing and re-adding the domain, then redeploying, triggered a
fresh request — `blaze.crafter.run` now serves a real Let's Encrypt certificate.

A wildcard `*.blaze.crafter.run` is still worth adding: dedicated engines and per-database
SNI routing will each need their own hostname.

## BLOCKER — Postgres has no TLS

Issued connection strings end in `?sslmode=require`, and the shared instance reports
`ssl = off`:

```
sslmode=require  FAIL  The server does not support SSL connections
```

**No real connection string works until this is fixed.** The fix is not to drop
`sslmode=require` — that would ship unencrypted database traffic across the public
internet for a product holding other people's data. Two real options:

1. Terminate TLS at Traefik with a TCP router for `pg.blaze.crafter.run`, reusing the
   Let's Encrypt certificate Traefik already manages. Also the path to SNI-routed
   per-database hostnames (PLAN.md Q12, option c).
2. Configure `ssl = on` inside the Postgres container with a mounted certificate, plus
   renewal.

(1) is preferred: one certificate, one renewal path, and it is the direction the
connection-string design already points.

## Ports

| Service | Port | Note |
|---|---|---|
| `blaze-pg-1` | **5433** | Public. Not 5432 — Dokploy's own Postgres holds that port. Baked into connection strings; see `lib/engines/types.ts`. |
| `blaze-control` | 5501 | Public **only** to run migrations from a laptop. |

`blaze-control` should be closed once migrations run on the VPS or in CI. It holds every
tenant's encrypted credentials and has no reason to be reachable from the internet.

## Operations

```bash
# Apply migrations
DATABASE_URL=... bun run db:migrate

# Register an instance and harden it (idempotent)
CONTROL_URL=... ENCRYPTION_KEY=... NODE_NAME=crafter-vps-1 \
INSTANCE_ENGINE=postgres INSTANCE_HOST=blaze-pg-1-yu7lyz INSTANCE_PORT=5432 \
INSTANCE_ADMIN_USER=blazeadmin INSTANCE_ADMIN_PASSWORD=... INSTANCE_VERSION=18.6 \
HARDEN_URL=... bun run scripts/bootstrap-instance.ts

# Verify provisioning and cross-tenant isolation against a real instance
ENCRYPTION_KEY=... ADMIN_URL=... bun run scripts/smoke-provision.ts
```

`ENCRYPTION_KEY` must match the value in the app's environment. Change it and every
stored tenant password becomes undecryptable — there is no recovery path, only reissuing
credentials for every database.

# Deployment

Live on the Crafter VPS (`95.111.248.246`) under the Dokploy project **blaze**.

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

## Required before this works end to end

**DNS records do not exist yet.** `crafter.run` has no wildcard, so nothing under
`blaze.crafter.run` resolves. Two records are needed, both `A` → `95.111.248.246`:

| Record | Why |
|---|---|
| `blaze.crafter.run` | The app itself. Until this exists the site is unreachable and Let's Encrypt cannot issue a certificate. |
| `pg.blaze.crafter.run` | Every Postgres connection string blaze issues points here. Tenants cannot connect without it. |

A wildcard `*.blaze.crafter.run` → `95.111.248.246` covers both and pre-empts the
per-database hostnames that dedicated engines and SNI routing will need later.

This is the one blocker that cannot be resolved from code: connection strings are
permanent, so blaze deliberately will not fall back to handing out `IP:port`.

## External ports

`blaze-control` is on `5501` and `blaze-pg-1` on `5502`, both publicly reachable. They
were opened to run migrations and the provisioning smoke test from a laptop.

`blaze-control` should be closed once CI or an on-VPS migration step exists — it holds
every tenant's encrypted credentials and has no reason to be on the public internet.
`blaze-pg-1` stays open only until `pg.blaze.crafter.run` resolves and Traefik fronts it.

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

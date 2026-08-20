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

## TLS — enabled and enforced

`blaze-pg-1` serves **TLSv1.3**, and unencrypted connections are **refused**:

```
plaintext: no pg_hba.conf entry for host "...", user "blazeadmin", ... no encryption
```

How it was done, with no shell access to the VPS:

- The certificate was generated **inside the container** via `COPY ... TO PROGRAM` as
  superuser, so the private key never crossed the network. It lives in the data directory,
  which is a persistent volume, so it survives redeploys.
- `ssl` is SIGHUP-reloadable, so enabling it needed no restart. A bad certificate would
  have failed the reload and left the server running with `ssl = off` rather than taking
  the instance down.
- `pg_hba.conf` was switched from `host` to `hostssl` for external connections. That edit
  is unrecoverable if it locks everyone out, so it was applied through a **held-open
  session** — a reload does not affect established connections, so that session could
  still restore the backup at `pg_hba.conf.blaze-backup`. Loopback and unix-socket rules
  were left as `trust` so the container's own health check keeps working.

### Residual gap: the certificate is self-signed

Encryption in transit is real; **server authentication is not**. An active
man-in-the-middle is not defeated by a certificate the client cannot validate.

Practical effect on clients using `?sslmode=require`:

| Client | Result |
|---|---|
| libpq, `psql`, psycopg, pgx, Prisma, postgres.js | works — `require` means encrypt, do not verify |
| node-postgres 8.23+ | **fails** — it currently aliases `require` to `verify-full`; use `sslmode=no-verify` |

Getting a publicly trusted certificate needs ACME validation for `pg.blaze.crafter.run`,
which needs either port 80/443 (Traefik holds both) or DNS-01 (the `crafters` CLI only
writes CNAMEs). Both need VPS file access or a new ACME path, so it is a separate piece
of work — the direction remains PLAN.md Q12 option (c): terminate TLS at a proxy holding
a real certificate.

blaze's own admin connections use `sslmode=no-verify`: the certificate is one blaze
generated on that instance, so there is no chain to validate, but the hop is encrypted.


## MongoDB — implemented, not offered (TLS unresolved)

`lib/provision/mongo.ts` is complete and verified against a live instance: tenants own
their database, cannot touch another tenant's or `admin`, stats report, suspend/resume
work. It is deliberately absent from `PROVISIONABLE` because TLS cannot be enforced, and
Postgres and MySQL both refuse plaintext while the landing page promises TLS.

The instance now runs as a **compose stack** (`blaze-mongo-tls`, composeId
`BDaAhTKPE2QtCcOgccACu`) rather than a Dokploy `mongo` service, because that abstraction
stores a `command` and never passes it to the container — confirmed by reading
`getCmdLineOpts`, which kept showing `["mongod","--auth","--bind_ip_all"]`.

### What is actually blocking it

Compose runs Mongo fine. **Every variant that enables TLS fails to start**, and all three
attempts failed identically — the deploy reports `done`, the container never listens:

| Attempt | Result |
|---|---|
| Dokploy file mount at `/etc/mongo-tls/mongo.pem` + TLS flags | never listens |
| Self-generating cert on the data volume via a custom `entrypoint` | never listens |
| Inline compose `configs:` with `content:` | never listens |

The baseline — identical compose minus the TLS flags and certificate — starts in ~24s
every time. So the fault is in the TLS setup, not the compose plumbing, ports, network or
volume.

**Diagnosis is blocked on container logs.** Dokploy writes them to
`/etc/dokploy/logs/<app>/…` on the VPS, and no API endpoint exposes them. Without stderr
from a crash-looping mongod this is guesswork: the plausible causes (certificate
permissions or ownership, the file never landing at that path, `preferTLS` interacting
with the image's init step) are indistinguishable from outside.

**Next step: SSH, or any way to read those logs.** One look at the container's stderr
almost certainly settles it.

The stack is currently deployed **without** TLS so the VPS is left in a working state.

## The blocker that stops Mongo, Redis and libSQL

All three need a certificate file inside a container, and every attempt fails the same
way with no diagnosable output.

What is established:

- **Dokploy ignores `command` on database services.** Verified on Mongo by reading
  `getCmdLineOpts` after setting it: the running argv never changed.
- **Compose gives back that control**, and a compose Mongo without TLS starts in ~24s —
  so plumbing, ports, network and volumes are all fine.
- **Every TLS variant fails identically**: deploy reports `done`, the container never
  listens. Tried a file mount, a self-generating certificate via a custom entrypoint, and
  an inline compose `configs:` block.
- **Redis fails at the same point from the other direction.** It can enable TLS at runtime
  with `CONFIG SET`, needing no `command` at all — but `CONFIG SET tls-port` returns
  *"Unable to update TLS configuration. Check server logs."*

Note on that last one: `CONFIG SET tls-cert-file` **succeeding does not prove the file
exists**. Redis stores the path and only loads it when the TLS context is built at
`tls-port`. An earlier note here claimed the mount was proven working; it was not.

The leading hypothesis is that Dokploy's file mounts do not place a file where expected,
so Docker bind-mounts a **directory** at that path — which would explain Mongo and Redis
failing identically for what looks like two unrelated reasons. It is a hypothesis because
it cannot be checked from outside.

**One thing unblocks all of it: the ability to read container logs, or SSH.** Dokploy
writes logs to `/etc/dokploy/logs/<app>/…` and exposes no endpoint for them. Redis even
says "check server logs" — and that is precisely what is unavailable.

Until then Postgres, MySQL and MariaDB are offered; Mongo has a complete, verified
provisioner behind the flag; Redis and libSQL are not started.

### Operational warnings learned the hard way

- **`mongo.rebuild` runs `docker volume rm <service>-data --force`.** It is a data-loss
  operation, not a restart. `mongo.reload` scales the service and left it down.
- **`CONFIG SET port 0` on Redis before TLS is confirmed makes the instance unreachable**,
  and it cannot be undone remotely because there is no port left to connect on. Always
  bind TLS to a spare port first and only then move it onto the published one.

## Ports

| Service | Port | Note |
|---|---|---|
| `blaze-pg-1` | **5433** | Public. Not 5432 — Dokploy's own Postgres holds that port. Baked into connection strings; see `lib/engines/types.ts`. |
| `blaze-control` | 5501 | Public **only** to run migrations from a laptop. |

`blaze-control` should be closed once migrations run on the VPS or in CI. It holds every
tenant's encrypted credentials and has no reason to be reachable from the internet.


## Metrics cron — needs scheduling

`POST /api/cron/metrics` samples every database, writes a point to `database_metrics`,
and enforces the storage quota by suspending anything over the limit (and reinstating
anything back under it). **Nothing schedules it yet** — it has to be called every 5
minutes or quotas go unenforced and charts stay empty.

```bash
curl -X POST https://blaze.crafter.run/api/cron/metrics   -H "Authorization: Bearer $CRON_SECRET"
# {"sampled":1,"suspended":0,"errors":0,"tookMs":231}
```

Add it as a Dokploy schedule (or a host crontab entry) at `*/5 * * * *`. The secret lives
in the app's environment as `CRON_SECRET`; with it unset the endpoint refuses everything,
because it can suspend databases and reach every instance.

Verified in production: 401 with no header, 401 with a wrong secret, 200 with the right
one, and a sweep of one database in 231ms.

## Operations

```bash
# Apply migrations
DATABASE_URL=... bun run db:migrate

# Register an instance and harden it (idempotent)
CONTROL_URL=... ENCRYPTION_KEY=... NODE_NAME=crafter-vps-1 \
INSTANCE_ENGINE=postgres INSTANCE_HOST=blaze-pg-1-yu7lyz INSTANCE_PORT=5432 \
INSTANCE_ADMIN_USER=blazeadmin INSTANCE_ADMIN_PASSWORD=... INSTANCE_VERSION=18.6 \
HARDEN_URL=... bun run scripts/bootstrap-instance.ts

# Verify provisioning and cross-tenant isolation against a real instance.
# ADMIN_URL must carry ?sslmode=no-verify — the instance refuses plaintext.
ENCRYPTION_KEY=... ADMIN_URL=...?sslmode=no-verify bun run scripts/smoke-provision.ts
```

`ENCRYPTION_KEY` must match the value in the app's environment. Change it and every
stored tenant password becomes undecryptable — there is no recovery path, only reissuing
credentials for every database.

# blaze — plan

Managed databases in 200ms. Free, agent-native, six engines.
Runs on one Dokploy VPS. Successor to `db.crafter.run`.

Status: **planning complete, no code written.** Every decision below was settled in a
grilling session; nothing here is assumed.

---

## 1. What blaze is

A **public, free** managed-database product where anyone signs up and provisions a
database — from a REST API, an MCP server, or a dashboard. Aimed primarily at **AI agents**
that need a database in under a second, but equally usable by humans.

It is **not** a Neon clone in mechanism. It borrows Neon's information architecture and
developer-tool design language, and nothing else.

**What we have that Neon doesn't:** sub-second creation, six engines, MCP-native, free.
**What we don't have and won't fake:** branching, autoscaling, scale-to-zero, PITR.

---

## 2. Settled decisions

| # | Decision | Answer |
|---|---|---|
| Q1 | Audience | Public, multi-tenant, strangers sign up |
| Q2 | Branching | **None.** Fast creation instead |
| Q3 | Codebase | Fresh repo in `blaze/`, port `lib/dokploy/*` + `lib/db/*` verbatim |
| Q4/Q9 | Engines | All six: postgres, mysql, mariadb, mongo, redis, libsql |
| Q5 | Provisioning | Hybrid, shared-first; `mode` field from day one |
| Q6 | Surface order | REST API → MCP server → dashboard |
| Q7 | Lifecycle | TTL as a first-class field, for humans and agents alike |
| Q8 | Billing | **None.** Free, hard cap 5 databases/user. Revisit later |
| Q10 | Visual | Neon's IA and design language, own brand/palette/copy |
| Q11 | Hierarchy | `project → database`, project auto-created as "default" |
| Q12 | Connections | Hostnames from day one, never IPs. TLS required |
| Q13 | Tenancy | Shared: pg/mysql/mariadb/mongo. Dedicated container: redis/libsql |
| Q14 | Abuse | OAuth-only signup, hard quotas, reaper, waitlist at launch |
| Q15 | Backups | Nightly logical dumps to existing MinIO, 7-day retention |
| Q16 | Capacity | `nodes`/`instances` modelled now, one row to start |
| Q17 | Brand | "blaze", apex domain, warm amber accent |
| Q18 | UI scope | All six usable day one; SQL editor + table browser for the 4 SQL engines |
| Q19 | Monitoring | Engine-native stats polled into control DB; doubles as quota enforcement |
| Q20 | MCP | Provisioning tools **plus** `run_query` scoped to the key's own databases |
| Q21 | Landing | "Any database in 200ms", engine grid, honest limits, **no fake social proof** |
| Q22 | Launch bar | Private alpha, waitlist, ~20 users |

---

## 3. Architecture

```
                     blaze.run   (Next.js 16 / React 19 / Tailwind 4 / Bun)
                          |
        +-----------------+------------------+
        |                 |                  |
   dashboard         REST /v1/*          MCP server
   (Clerk session)   (API keys)          (API keys)
        +-----------------+------------------+
                          |
                   control plane
              (Postgres + Drizzle, own DB)
                          |
        +-----------------+-------------------------+
        |                 |                         |
  provisioner        reaper (cron)            metrics poller (cron)
        |            TTL + quota + orphans    pg_database_size etc
        |
        +-- shared instances ----> CREATE DATABASE + role
        |     pg . mysql . mariadb . mongo
        |
        +-- dedicated containers -> Dokploy API
              redis . libsql
```

**Connection routing.** Every database gets a hostname, never an IP:

```
postgresql://u_a1b2c3:PASS@pg.blaze.run:5432/db_x7f2?sslmode=require
mysql://u_a1b2c3:PASS@mysql.blaze.run:3306/db_x7f2
mongodb://u_a1b2c3:PASS@mongo.blaze.run:27017/db_x7f2
redis://:PASS@redis.blaze.run:6379          (dedicated, SNI-routed later)
```

One DNS record per engine today. Traefik (already running under Dokploy) does TCP/SNI
routing, so per-database hostnames (`x7f2.pg.blaze.run`) drop in later without breaking a
single existing connection string. Wildcard cert on `*.blaze.run`.

**Why this matters:** connection strings are permanent. The inherited `IP:5433-5999` scheme
caps the whole product at 567 databases forever and welds it to one machine.

---

## 4. Control-plane schema (Drizzle)

`db.crafter.run` is stateless; blaze cannot be.

```
users            clerk_user_id, email, plan, created_at
projects         id, slug, name, owner_user_id, created_at
nodes            id, name, ssh_host, status, capacity_hint
instances        id, node_id, engine, version, mode(shared|dedicated),
                 internal_host, port, admin_secret_ref, database_count, status
databases        id, slug, project_id, engine, mode, instance_id,
                 db_name, role_name, password_enc, status,
                 size_bytes, expires_at, created_at, deleted_at
api_keys         id, user_id, name, key_hash, key_prefix, last_used_at, revoked_at
database_metrics database_id, ts, size_bytes, connections, xact_commit
backups          id, database_id, object_key, size_bytes, status, created_at, expires_at
audit_log        id, actor, action, target, metadata, created_at
```

Notes:

- `password_enc` is **encrypted, not hashed** — the connection string has to be displayable.
  AES-GCM with a key from env.
- `api_keys.key_hash` **is** hashed. Prefix stored plaintext for display (`blz_live_a1b2...`).
- `mode` + `instance_id` are the seam that lets a dedicated-container tier land later
  without a migration.

---

## 5. API surface

```
POST   /v1/databases              { engine, name?, project?, ttl? } -> connection string
GET    /v1/databases
GET    /v1/databases/:id
PATCH  /v1/databases/:id          { name?, ttl? }
DELETE /v1/databases/:id
POST   /v1/databases/:id/query    { sql }        <- powers MCP run_query + SQL editor
POST   /v1/databases/:id/reset-password
GET    /v1/databases/:id/backups
POST   /v1/databases/:id/restore  { backup_id }
GET    /v1/projects   POST /v1/projects
```

Auth: `Authorization: Bearer blz_live_...`. The dashboard consumes this same public API —
which forces the API to be complete rather than an afterthought.

**MCP tools:** `create_database`, `list_databases`, `get_connection_string`,
`delete_database`, `set_ttl`, `run_query`.

---

## 6. Guardrails

Enforced at creation and by a cron reaper:

- 5 databases per user, 500MB per database
- `statement_timeout = 30s`, `idle_in_transaction_session_timeout`
- `CONNECTION LIMIT 20` per role
- `REVOKE ALL ON SCHEMA public FROM PUBLIC` — tenants cannot see each other
- TTL: no default for humans, 24h suggested for agent-created; reaper deletes on expiry
- OAuth-only signup (GitHub + Google via Clerk). No password accounts, no disposable email
- Waitlist gate at launch

Postgres has **no native per-database disk quota** — the metrics poller (§7) is the
enforcement mechanism, not just a chart feed.

Redis and libsql get dedicated containers precisely because Redis ACLs cannot be trusted
for tenancy: `FLUSHALL` / `FLUSHDB` / `SWAPDB` take no key arguments and bypass key
patterns, and there is no per-user memory limit.

---

## 7. Monitoring

Dokploy's container metrics now describe a shared cluster, not a tenant — useless per user.
Instead, a 5-minute cron polls engine-native stats into `database_metrics`:

- `pg_database_size()` -> storage + quota enforcement
- `pg_stat_activity` -> connection count
- `pg_stat_database.xact_commit` -> transactions/sec

Rendered with Recharts (already in the stack). No Prometheus.

---

## 8. Open spike

**libsql namespaces.** `sqld` may support multiple namespaces per server with Host-header
routing, which would move libsql from dedicated to shared. Unverified — the README does not
document it. Timebox a spike; if it does not hold, dedicated containers are the fallback and
nothing else in this plan changes.

---

## 9. Build order

1. ~~**Foundation**~~ — **done.** Next.js 16 + Tailwind 4 + Bun, Clerk, Drizzle schema and
   migrations applied, six drivers ported to `lib/engines/*`, `lib/dokploy/*` reduced to
   container lifecycle.
2. ~~**Provisioner**~~ — **done.** Shared Postgres on the VPS, `CREATE DATABASE` + scoped
   role + grants, instance hardening, deployed to `blaze.crafter.run`. See DEPLOY.md.
   Isolation verified by `scripts/smoke-provision.ts`. **Blocked on DNS** before tenant
   connection strings resolve; 200ms still to be measured from inside the VPS.
3. **REST API** — full `/v1` surface, API keys, quotas. This is the product.
4. **MCP server** — six tools over the API. The differentiator.
5. **Reaper + metrics** — TTL expiry, quota enforcement, 5-minute poller.
6. **Dashboard** — brand and design system first, then overview/connect, settings, SQL
   editor, table browser. Consumes `/v1`.
7. **Remaining engines** — mysql, mariadb, mongo shared; redis, libsql dedicated.
8. **Backups** — nightly dumps to MinIO, restore-into-new-database.
9. **Landing page** — hero, engine grid, three differentiators, honest limits, docs.
10. **Alpha** — waitlist, ~20 users, watch the quotas hold.

Retire `db.crafter.run` once blaze reaches parity.

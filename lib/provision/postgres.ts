import { Client } from "pg";

// No `server-only` guard: bootstrap and smoke scripts run this outside Next. It imports
// `pg` and touches no request context, so there is nothing here a client bundle could
// leak — and a copy of this DDL living in a script would be far more dangerous.
import { LIMITS } from "@/lib/limits";
import { quoteIdent, quoteLiteral } from "./identifiers";

/**
 * Tenant provisioning on a **shared** Postgres instance.
 *
 * Creating a database here is `CREATE ROLE` + `CREATE DATABASE` + grants — a few
 * round-trips against an already-running server, so roughly 200ms and effectively no
 * marginal memory. The alternative blaze rejected, one container per database, costs
 * 10-60s and ~100MB that is never given back (PLAN.md Q5).
 *
 * The cost of density is that isolation is now our job rather than Docker's. Four things
 * are load-bearing and none of them are defaults:
 *
 *  1. `REVOKE CONNECT ... FROM PUBLIC` — without it *every* tenant role can connect to
 *     *every* tenant database on the instance. This is the one that matters most.
 *  2. `REVOKE ALL ON SCHEMA public FROM PUBLIC` — Postgres 15+ does this by default, but
 *     stating it means blaze does not silently regress if an instance runs an older image.
 *  3. `CONNECTION LIMIT` — one tenant cannot exhaust `max_connections` for the instance.
 *  4. `statement_timeout` — one tenant cannot pin a core with a runaway query.
 *
 * Storage is the gap these cannot close: Postgres has no per-database disk quota, so the
 * metrics poller is the only thing standing between one tenant and the whole volume.
 */

export interface PostgresProvisionRequest {
	adminUrl: string;
	dbName: string;
	roleName: string;
	password: string;
}

/**
 * `CREATE DATABASE` cannot run inside a transaction block, so this is not atomic. On
 * failure we unwind by hand — a half-created tenant (role but no database) would silently
 * consume a name and confuse the next attempt.
 */
export async function provisionPostgresDatabase(req: PostgresProvisionRequest): Promise<void> {
	const db = quoteIdent("database", req.dbName);
	const role = quoteIdent("role", req.roleName);
	const password = quoteLiteral(req.password);

	const admin = new Client({ connectionString: req.adminUrl });
	await admin.connect();

	let roleCreated = false;
	let databaseCreated = false;

	try {
		await admin.query(
			`CREATE ROLE ${role} LOGIN PASSWORD ${password} CONNECTION LIMIT ${LIMITS.CONNECTION_LIMIT}`,
		);
		roleCreated = true;

		// Must be its own round trip: CREATE DATABASE cannot run inside a transaction block,
		// and libpq wraps any multi-statement simple query in one.
		await admin.query(`CREATE DATABASE ${db} OWNER ${role}`);
		databaseCreated = true;

		// The rest batch into a single round trip. Latency dominates provisioning time, so
		// each round trip saved is real budget against the 200ms target.
		await admin.query(
			[
				// Deny the whole instance by default, then grant this one tenant back in.
				`REVOKE CONNECT ON DATABASE ${db} FROM PUBLIC`,
				`GRANT CONNECT ON DATABASE ${db} TO ${role}`,
				// Per-role, per-database settings, so one tenant's limits can be raised later
				// without touching anyone else.
				`ALTER ROLE ${role} IN DATABASE ${db} SET statement_timeout = ${LIMITS.STATEMENT_TIMEOUT_MS}`,
				`ALTER ROLE ${role} IN DATABASE ${db} SET idle_in_transaction_session_timeout = ${LIMITS.IDLE_TRANSACTION_TIMEOUT_MS}`,
			].join("; "),
		);
	} catch (error) {
		if (databaseCreated) await admin.query(`DROP DATABASE IF EXISTS ${db}`).catch(() => {});
		if (roleCreated) await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
		await admin.end();
		throw error;
	}

	await admin.end();

	// Schema-level grants have to be issued while connected to the new database.
	const tenantAdminUrl = replaceDatabase(req.adminUrl, req.dbName);
	const inDb = new Client({ connectionString: tenantAdminUrl });
	await inDb.connect();
	try {
		await inDb.query(
			[
				"REVOKE ALL ON SCHEMA public FROM PUBLIC",
				`GRANT ALL ON SCHEMA public TO ${role}`,
				`ALTER SCHEMA public OWNER TO ${role}`,
			].join("; "),
		);
	} finally {
		await inDb.end();
	}
}

/**
 * One-time hardening applied when an instance is registered, not per tenant.
 *
 * Postgres grants `CONNECT` on the `postgres` and `template1` databases to `PUBLIC` by
 * default. On a single-tenant server that is harmless. On a shared instance it means any
 * tenant role can connect to the maintenance database and read `pg_database` and
 * `pg_roles` — enumerating every other customer's database and role names, which is both
 * an information leak and a target list.
 *
 * Superusers bypass these grants, so blaze's own admin connection is unaffected.
 *
 * This was found by `scripts/smoke-provision.ts`, not by reading the docs: per-tenant
 * grants all looked correct and cross-tenant access was properly denied. The hole was one
 * level up, in a database no tenant is ever told about.
 */
export async function hardenPostgresInstance(adminUrl: string): Promise<void> {
	const admin = new Client({ connectionString: adminUrl });
	await admin.connect();
	try {
		await admin.query(
			[
				"REVOKE CONNECT ON DATABASE postgres FROM PUBLIC",
				"REVOKE CONNECT ON DATABASE template1 FROM PUBLIC",
				// Tenants have no business creating objects in a database they cannot reach,
				// but revoke it anyway so a future grant cannot quietly re-open the path.
				"REVOKE ALL ON SCHEMA public FROM PUBLIC",
			].join("; "),
		);
	} finally {
		await admin.end();
	}
}

/**
 * Drops the database and its role.
 *
 * `WITH (FORCE)` terminates live connections — needed because a tenant whose TTL expired
 * or whose account was suspended is exactly the tenant most likely to still be connected.
 */
export async function deprovisionPostgresDatabase(
	adminUrl: string,
	dbName: string,
	roleName: string,
): Promise<void> {
	const db = quoteIdent("database", dbName);
	const role = quoteIdent("role", roleName);

	const admin = new Client({ connectionString: adminUrl });
	await admin.connect();
	try {
		await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
		// Settings set via ALTER ROLE ... IN DATABASE outlive the database on some versions.
		await admin.query(`DROP ROLE IF EXISTS ${role}`);
	} finally {
		await admin.end();
	}
}

/** Suspend without data loss: revoke connect, kick sessions, keep the bytes. */
export async function suspendPostgresDatabase(
	adminUrl: string,
	dbName: string,
	roleName: string,
): Promise<void> {
	const db = quoteIdent("database", dbName);
	const role = quoteIdent("role", roleName);

	const admin = new Client({ connectionString: adminUrl });
	await admin.connect();
	try {
		await admin.query(`REVOKE CONNECT ON DATABASE ${db} FROM ${role}`);
		await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [
			dbName,
		]);
	} finally {
		await admin.end();
	}
}

export async function resumePostgresDatabase(
	adminUrl: string,
	dbName: string,
	roleName: string,
): Promise<void> {
	const admin = new Client({ connectionString: adminUrl });
	await admin.connect();
	try {
		await admin.query(
			`GRANT CONNECT ON DATABASE ${quoteIdent("database", dbName)} TO ${quoteIdent("role", roleName)}`,
		);
	} finally {
		await admin.end();
	}
}

/**
 * Rotate a tenant's password.
 *
 * Existing sessions survive — Postgres authenticates at connect time, so anything already
 * connected keeps working until it reconnects. That is the right behaviour for a rotation
 * a user asked for, and the wrong one for a leak; revoking a compromised credential means
 * rotating *and* terminating, which is what `suspendPostgresDatabase` does.
 */
export async function resetPostgresPassword(
	adminUrl: string,
	roleName: string,
	password: string,
): Promise<void> {
	const admin = new Client({ connectionString: adminUrl });
	await admin.connect();
	try {
		await admin.query(
			`ALTER ROLE ${quoteIdent("role", roleName)} WITH PASSWORD ${quoteLiteral(password)}`,
		);
	} finally {
		await admin.end();
	}
}

/** Size and activity for one tenant. Feeds both the quota check and the charts. */
export async function readPostgresStats(
	adminUrl: string,
	dbName: string,
): Promise<{ sizeBytes: number; connections: number; xactCommit: number }> {
	const admin = new Client({ connectionString: adminUrl });
	await admin.connect();
	try {
		const { rows } = await admin.query(
			`SELECT pg_database_size(d.datname)::bigint AS size_bytes,
			        COALESCE(s.numbackends, 0) AS connections,
			        COALESCE(s.xact_commit, 0)::bigint AS xact_commit
			 FROM pg_database d
			 LEFT JOIN pg_stat_database s ON s.datname = d.datname
			 WHERE d.datname = $1`,
			[dbName],
		);
		if (rows.length === 0) throw new Error(`Database ${dbName} not found`);
		return {
			sizeBytes: Number(rows[0].size_bytes),
			connections: Number(rows[0].connections),
			xactCommit: Number(rows[0].xact_commit),
		};
	} finally {
		await admin.end();
	}
}

/** Swap the database component of a Postgres URL, preserving credentials and options. */
function replaceDatabase(url: string, dbName: string): string {
	const parsed = new URL(url);
	parsed.pathname = `/${dbName}`;
	return parsed.toString();
}

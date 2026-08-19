import mysql from "mysql2/promise";
import { LIMITS } from "@/lib/limits";
import { quoteIdentMysql, quoteLiteral } from "./identifiers";

/**
 * Tenant provisioning on a **shared** MySQL instance.
 *
 * Same model as Postgres — `CREATE DATABASE` plus a user scoped to it — but MySQL's
 * differences are load-bearing and worth stating rather than discovering later:
 *
 * - **The admin connects as `root`.** Creating users and granting per-database privileges
 *   requires `CREATE USER` and `GRANT OPTION` on `*.*`, which is root in all but name.
 *   A "least-privilege admin" holding those would be security theatre, so this is honest
 *   about what it needs.
 * - **`SHOW DATABASES` is already scoped.** MySQL only lists databases the user has
 *   privileges on, so tenants cannot enumerate each other — unlike Postgres, where
 *   `CONNECT` had to be explicitly revoked from `PUBLIC`.
 * - **Suspension uses `ACCOUNT LOCK`**, which blocks login without touching data. It is a
 *   cleaner primitive than the revoke-and-terminate dance Postgres needs.
 * - **`max_execution_time` only bounds `SELECT`.** It is set globally on the instance and
 *   is the closest analogue to `statement_timeout`, but a runaway `UPDATE` is not covered.
 *   `MAX_USER_CONNECTIONS` is the limit that actually contains a bad tenant here.
 */

/** mysql2 needs a config object rather than a URL, because the TLS options are not URL-expressible. */
function config(adminUrl: string, database?: string) {
	const url = new URL(adminUrl);
	return {
		host: url.hostname,
		port: Number(url.port || 3306),
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database,
		connectTimeout: 15_000,
		// The instance presents the certificate MySQL generates for itself at initialisation.
		// There is no chain to validate, but the connection is encrypted — and the server
		// refuses unencrypted ones outright (`require_secure_transport=ON`).
		ssl: { rejectUnauthorized: false },
		multipleStatements: false,
	};
}

export interface MysqlProvisionRequest {
	adminUrl: string;
	dbName: string;
	roleName: string;
	password: string;
}

/**
 * MySQL DDL is not transactional, so this unwinds by hand on failure — a half-created
 * tenant would hold a name that the next attempt then collides with.
 */
export async function provisionMysqlDatabase(req: MysqlProvisionRequest): Promise<void> {
	const db = quoteIdentMysql("database", req.dbName);
	const user = quoteLiteral(req.roleName);
	const password = quoteLiteral(req.password);

	const conn = await mysql.createConnection(config(req.adminUrl));
	let userCreated = false;
	let databaseCreated = false;

	try {
		await conn.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
		databaseCreated = true;

		// '%' rather than a fixed host: tenants connect from anywhere, and pinning the host
		// would silently break every client that moves.
		await conn.query(`CREATE USER ${user}@'%' IDENTIFIED BY ${password}`);
		userCreated = true;

		// Scoped to this database only. No global grants, ever.
		await conn.query(`GRANT ALL PRIVILEGES ON ${db}.* TO ${user}@'%'`);
		await conn.query(`ALTER USER ${user}@'%' WITH MAX_USER_CONNECTIONS ${LIMITS.CONNECTION_LIMIT}`);
		await conn.query("FLUSH PRIVILEGES");
	} catch (error) {
		if (userCreated) await conn.query(`DROP USER IF EXISTS ${user}@'%'`).catch(() => {});
		if (databaseCreated) await conn.query(`DROP DATABASE IF EXISTS ${db}`).catch(() => {});
		throw error;
	} finally {
		await conn.end().catch(() => {});
	}
}

export async function deprovisionMysqlDatabase(
	adminUrl: string,
	dbName: string,
	roleName: string,
): Promise<void> {
	const conn = await mysql.createConnection(config(adminUrl));
	try {
		// Dropping the user first stops new connections landing while the drop runs.
		await conn.query(`DROP USER IF EXISTS ${quoteLiteral(roleName)}@'%'`);
		await conn.query(`DROP DATABASE IF EXISTS ${quoteIdentMysql("database", dbName)}`);
	} finally {
		await conn.end().catch(() => {});
	}
}

/** Blocks login and kills live sessions. Data is untouched. */
export async function suspendMysqlDatabase(adminUrl: string, roleName: string): Promise<void> {
	const conn = await mysql.createConnection(config(adminUrl));
	try {
		await conn.query(`ALTER USER ${quoteLiteral(roleName)}@'%' ACCOUNT LOCK`);

		// ACCOUNT LOCK only stops *new* logins, so existing sessions have to be killed
		// explicitly or an over-quota tenant keeps writing on its open connection.
		const [rows] = await conn.query<mysql.RowDataPacket[]>(
			"SELECT id FROM information_schema.processlist WHERE user = ?",
			[roleName],
		);
		for (const row of rows) {
			await conn.query(`KILL ${Number(row.id)}`).catch(() => {});
		}
	} finally {
		await conn.end().catch(() => {});
	}
}

export async function resumeMysqlDatabase(adminUrl: string, roleName: string): Promise<void> {
	const conn = await mysql.createConnection(config(adminUrl));
	try {
		await conn.query(`ALTER USER ${quoteLiteral(roleName)}@'%' ACCOUNT UNLOCK`);
	} finally {
		await conn.end().catch(() => {});
	}
}

export async function resetMysqlPassword(
	adminUrl: string,
	roleName: string,
	password: string,
): Promise<void> {
	const conn = await mysql.createConnection(config(adminUrl));
	try {
		await conn.query(
			`ALTER USER ${quoteLiteral(roleName)}@'%' IDENTIFIED BY ${quoteLiteral(password)}`,
		);
	} finally {
		await conn.end().catch(() => {});
	}
}

/**
 * Size and activity for one tenant.
 *
 * `information_schema.tables` sizes are approximate for InnoDB — they come from the
 * optimiser's statistics, not a live count — which is fine for a quota checked every five
 * minutes and would not be fine for billing.
 */
export async function readMysqlStats(
	adminUrl: string,
	dbName: string,
): Promise<{ sizeBytes: number; connections: number; xactCommit: number }> {
	const conn = await mysql.createConnection(config(adminUrl));
	try {
		const [size] = await conn.query<mysql.RowDataPacket[]>(
			`SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes
			 FROM information_schema.tables WHERE table_schema = ?`,
			[dbName],
		);
		const [conns] = await conn.query<mysql.RowDataPacket[]>(
			"SELECT COUNT(*) AS n FROM information_schema.processlist WHERE db = ?",
			[dbName],
		);
		const [commits] = await conn.query<mysql.RowDataPacket[]>(
			"SHOW GLOBAL STATUS LIKE 'Com_commit'",
		);

		return {
			sizeBytes: Number(size[0]?.bytes ?? 0),
			connections: Number(conns[0]?.n ?? 0),
			// Instance-wide, not per-tenant: MySQL has no per-schema commit counter. Charted
			// as a delta like Postgres, it still shows activity, just not whose.
			xactCommit: Number(commits[0]?.Value ?? 0),
		};
	} finally {
		await conn.end().catch(() => {});
	}
}

/** One-time instance hardening, mirroring hardenPostgresInstance. */
export async function hardenMysqlInstance(adminUrl: string): Promise<void> {
	const conn = await mysql.createConnection(config(adminUrl));
	try {
		// Refuse unencrypted connections outright, rather than merely offering TLS.
		await conn.query("SET PERSIST require_secure_transport = ON");
		// Bounds SELECT only, but it is the closest thing MySQL has to statement_timeout.
		await conn.query(`SET PERSIST max_execution_time = ${LIMITS.STATEMENT_TIMEOUT_MS}`);
	} finally {
		await conn.end().catch(() => {});
	}
}

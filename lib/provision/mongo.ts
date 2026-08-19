import { MongoClient } from "mongodb";
import { assertSafeIdentifier } from "./identifiers";

/**
 * Tenant provisioning on a **shared** MongoDB instance.
 *
 * Mongo is natively multi-database with per-database users, so a tenant is a database
 * plus a user whose only role is `dbOwner` on that database. There is no `GRANT` to get
 * wrong and no equivalent of Postgres's `CONNECT ... FROM PUBLIC` problem: a Mongo user
 * can reach exactly the databases its roles name.
 *
 * Three things differ from the SQL engines and are worth stating rather than discovering:
 *
 * - **No per-user connection limit.** Mongo has no `MAX_USER_CONNECTIONS` equivalent, so
 *   `LIMITS.CONNECTION_LIMIT` cannot be enforced per tenant. Only the instance-wide
 *   `maxIncomingConnections` exists.
 * - **No statement timeout by default.** `maxTimeMS` is a per-operation client option, not
 *   a server-side policy, so a runaway query is not bounded the way it is on Postgres.
 * - **Suspension empties the user's roles** rather than locking the account. Mongo has no
 *   account lock; stripping roles leaves the user and its data intact while denying every
 *   operation, and `resume` puts the role back.
 *
 * Names are validated with the same identifier guard as SQL, even though Mongo takes them
 * as BSON strings rather than interpolating them into a query language. That is belt and
 * braces: it costs nothing and keeps one rule for what a tenant object may be called.
 */

function client(adminUrl: string): MongoClient {
	return new MongoClient(adminUrl, {
		serverSelectionTimeoutMS: 10_000,
		connectTimeoutMS: 10_000,
	});
}

export interface MongoProvisionRequest {
	adminUrl: string;
	dbName: string;
	roleName: string;
	password: string;
}

export async function provisionMongoDatabase(req: MongoProvisionRequest): Promise<void> {
	const dbName = assertSafeIdentifier("database", req.dbName);
	const user = assertSafeIdentifier("role", req.roleName);

	const conn = client(req.adminUrl);
	try {
		await conn.connect();

		// `dbOwner` on this database only — read, write, and schema management, scoped.
		await conn.db(dbName).command({
			createUser: user,
			pwd: req.password,
			roles: [{ role: "dbOwner", db: dbName }],
		});

		/*
		 * Mongo creates a database lazily, on first write. Without this the database does
		 * not appear in listDatabases and a size query returns nothing, so the dashboard
		 * would show a database that looks absent until the tenant happens to write.
		 */
		await conn.db(dbName).createCollection("_blaze");
	} finally {
		await conn.close().catch(() => {});
	}
}

export async function deprovisionMongoDatabase(
	adminUrl: string,
	dbName: string,
	roleName: string,
): Promise<void> {
	const conn = client(adminUrl);
	try {
		await conn.connect();
		// Drop the user first so nothing new connects while the database is going away.
		await conn
			.db(dbName)
			.command({ dropUser: roleName })
			.catch(() => {});
		await conn.db(dbName).dropDatabase();
	} finally {
		await conn.close().catch(() => {});
	}
}

/** Mongo has no account lock, so suspension strips every role. Data is untouched. */
export async function suspendMongoDatabase(
	adminUrl: string,
	dbName: string,
	roleName: string,
): Promise<void> {
	const conn = client(adminUrl);
	try {
		await conn.connect();
		await conn.db(dbName).command({ updateUser: roleName, roles: [] });
	} finally {
		await conn.close().catch(() => {});
	}
}

export async function resumeMongoDatabase(
	adminUrl: string,
	dbName: string,
	roleName: string,
): Promise<void> {
	const conn = client(adminUrl);
	try {
		await conn.connect();
		await conn
			.db(dbName)
			.command({ updateUser: roleName, roles: [{ role: "dbOwner", db: dbName }] });
	} finally {
		await conn.close().catch(() => {});
	}
}

export async function resetMongoPassword(
	adminUrl: string,
	roleName: string,
	password: string,
): Promise<void> {
	// The admin URL carries the tenant database in its path, which is also the user's
	// auth database — Mongo scopes users per database, so both must match.
	const dbName = new URL(adminUrl).pathname.replace(/^\//, "") || "admin";
	const conn = client(adminUrl);
	try {
		await conn.connect();
		await conn.db(dbName).command({ updateUser: roleName, pwd: password });
	} finally {
		await conn.close().catch(() => {});
	}
}

export async function readMongoStats(
	adminUrl: string,
	dbName: string,
): Promise<{ sizeBytes: number; connections: number; xactCommit: number }> {
	const conn = client(adminUrl);
	try {
		await conn.connect();
		const stats = await conn.db(dbName).command({ dbStats: 1 });
		const server = await conn.db("admin").command({ serverStatus: 1 });

		return {
			// storageSize is what the tenant actually occupies on disk, which is what the
			// quota is about — dataSize ignores compression and would over-report.
			sizeBytes: Number(stats.storageSize ?? 0),
			// Instance-wide: Mongo does not attribute connections to a database.
			connections: Number(server.connections?.current ?? 0),
			xactCommit: Number(server.opcounters?.command ?? 0),
		};
	} finally {
		await conn.close().catch(() => {});
	}
}

/**
 * No-op, deliberately.
 *
 * The hardening the other engines get — refuse unencrypted connections — cannot be
 * applied here through Dokploy: it stores a `command` for Mongo services but never passes
 * it to the container, so `--tlsMode requireTLS` never reaches mongod. See DEPLOY.md.
 * Throwing would block bootstrap; pretending to harden would be worse.
 */
export async function hardenMongoInstance(_adminUrl: string): Promise<void> {}

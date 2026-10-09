import { MongoClient } from "mongodb";
import { LIMITS } from "@/lib/limits";
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
 * - **The statement timeout covers reads only.** `hardenMongoInstance` sets MongoDB 8's
 *   `defaultMaxTimeMS` cluster parameter, which bounds find/aggregate/count/distinct
 *   server-side. Writes are not covered by it, and a client may still pass a larger
 *   `maxTimeMS` on its own operations — the honest limit, documented in limits.mdx.
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
	const user = assertSafeIdentifier("role", roleName);
	const conn = client(adminUrl);
	try {
		await conn.connect();
		/*
		 * Mongo scopes a user to the database it was created in, and that is the tenant's
		 * own database, not `admin` — so it has to be found before it can be updated. The
		 * engine interface passes only the role name here, so ask the server where it lives
		 * rather than guessing from naming conventions.
		 */
		const found = await conn.db("admin").command({
			usersInfo: { forAllDBs: true },
			filter: { user },
		});
		const users = (found.users ?? []) as { user: string; db: string }[];
		if (users.length !== 1)
			throw new Error(`Expected one Mongo user ${user}, found ${users.length}`);
		await conn.db(users[0].db).command({ updateUser: user, pwd: password });
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
 * Instance-wide policy that the image cannot express as a flag.
 *
 * TLS-only, auth and binding are enforced by `blaze/mongo-tls` itself (infra/mongo-tls),
 * before any connection is possible. What is left is the statement timeout: MongoDB 8's
 * `defaultMaxTimeMS` is a *cluster parameter*, stored in the instance's own config
 * database and applied to every read operation that does not set its own `maxTimeMS`.
 * Persisted by the server, so it survives restarts; idempotent, so bootstrap can rerun it.
 *
 * Verified on a standalone mongod 8.2 — no replica set needed.
 */
export async function hardenMongoInstance(adminUrl: string): Promise<void> {
	const conn = client(adminUrl);
	try {
		await conn.connect();
		await conn.db("admin").command({
			setClusterParameter: {
				defaultMaxTimeMS: { readOperations: LIMITS.STATEMENT_TIMEOUT_MS },
			},
		});
	} finally {
		await conn.close().catch(() => {});
	}
}

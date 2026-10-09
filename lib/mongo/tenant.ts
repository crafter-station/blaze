import "server-only";
import { type Db, MongoClient } from "mongodb";
import { tenantInternalConnectionString } from "@/lib/connection";
import type { Database, Instance } from "@/lib/control/schema";
import { resolveTenantTarget } from "@/lib/dev-override";

/**
 * A connection to a tenant's Mongo database **as the tenant**: its own user, whose only
 * role is `dbOwner` on its own database, over TLS. Never `blazeadmin`.
 *
 * That is the whole security model of the Browser and the Shell, the same one the SQL and
 * Redis consoles have: whatever that user may do is exactly what these pages can do. It
 * cannot read another tenant's database or `admin` (verified by smoke-provision), and when
 * the database is suspended its roles are empty, so these pages stop working too.
 *
 * One client per request with a pool of one and short timeouts: a stuck tenant never holds
 * a request open, and no connection outlives the request that made it.
 */

type Record_ = Database & { instance: Instance };

export const CONNECT_TIMEOUT_MS = 5_000;

export function tenantMongoUrl(record: Record_): string {
	const { host, port } = resolveTenantTarget("mongo", {
		host: record.instance.internalHost,
		port: record.instance.port,
	});
	return tenantInternalConnectionString(
		"mongo",
		host,
		port,
		record.dbName,
		record.roleName,
		record.passwordEnc,
	);
}

export async function withTenantMongo<T>(
	record: Record_,
	fn: (db: Db, client: MongoClient) => Promise<T>,
): Promise<T> {
	if (record.engine !== "mongo") throw new Error("Not a MongoDB database");
	const client = new MongoClient(tenantMongoUrl(record), {
		serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
		connectTimeoutMS: CONNECT_TIMEOUT_MS,
		maxPoolSize: 1,
		appName: "blaze-console",
	});
	try {
		await client.connect();
		return await fn(client.db(record.dbName), client);
	} finally {
		await client.close().catch(() => {});
	}
}

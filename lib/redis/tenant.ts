import "server-only";
import type { Database, Instance } from "@/lib/control/schema";
import { decryptSecret } from "@/lib/crypto";
import { resolveTenantTarget } from "@/lib/dev-override";
import { connectRedis, type RedisConnection } from "./client";

/**
 * A connection to a tenant's Redis **as the tenant**: ACL user `default`, with the
 * tenant's own password. Never `blazeadmin`.
 *
 * That is the whole security model of the console and the key browser, the same one the
 * SQL console has: whatever the tenant's ACL user may do is exactly what these pages can
 * do, and nothing more. The `default` user cannot run CONFIG, ACL or REPLICAOF, so it can
 * neither raise its own memory quota nor lock blaze out; suspension switches it off, and
 * then these pages stop working too, which is correct.
 *
 * One connection per request, short timeouts: a stuck tenant never holds a request open.
 */

export const TENANT_USER = "default";

/** Commands answer within this long, or the connection is dropped. */
export const COMMAND_TIMEOUT_MS = 8_000;

type Record_ = Database & { instance: Instance };

export async function connectTenantRedis(
	record: Record_,
	options: { commandTimeoutMs?: number; clientName?: string } = {},
): Promise<RedisConnection> {
	if (record.engine !== "redis") throw new Error("Not a Redis database");
	const { host, port } = resolveTenantTarget("redis", {
		host: record.instance.internalHost,
		port: record.instance.port,
	});
	return connectRedis({
		host,
		port,
		user: TENANT_USER,
		password: decryptSecret(record.passwordEnc),
		connectTimeoutMs: 5_000,
		commandTimeoutMs: options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS,
		clientName: options.clientName,
	});
}

export async function withTenantRedis<T>(
	record: Record_,
	fn: (conn: RedisConnection) => Promise<T>,
	options?: { commandTimeoutMs?: number; clientName?: string },
): Promise<T> {
	const conn = await connectTenantRedis(record, options);
	try {
		return await fn(conn);
	} finally {
		conn.close();
	}
}

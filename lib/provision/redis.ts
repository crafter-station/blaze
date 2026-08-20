import "server-only";
import Redis from "ioredis";
import type { EngineStats, ProvisionRequest } from "./engines";

/**
 * Tenant operations on a **dedicated** Redis container.
 *
 * Redis is the one engine blaze does not share between tenants, and the reason is that
 * its isolation primitives stop short of what a tenant boundary needs. Key patterns
 * (`~app:*`) constrain most commands but not all — and, more decisively, Redis has no
 * per-user memory limit, so on a shared instance one tenant filling memory degrades or
 * evicts every other tenant's data. A container idles at a few megabytes, which makes
 * one-per-tenant affordable here in a way it would not be for Postgres.
 *
 * Because the container *is* the database, most of what the other engines do with DDL is
 * done here by the container lifecycle in `dedicated.ts`. What remains in this file is
 * everything that happens over a live connection.
 *
 * Two properties come from the image (`blaze/redis-tls`) rather than from this code, and
 * both are deliberate — Dokploy overrides ENTRYPOINT/CMD for database services and
 * ignores its own `command` field, so anything expressed as a runtime flag would be
 * silently dropped:
 *
 * - **TLS is the only listener.** The plaintext port is closed (`--port 0`), so an
 *   unencrypted client fails to connect rather than succeeding quietly.
 * - **The quota is `maxmemory` with `noeviction`.** Redis enforces storage itself, at the
 *   moment of the write, instead of a sweep noticing five minutes late — and `noeviction`
 *   means an over-quota tenant is told its write failed rather than silently losing keys
 *   it believes it stored.
 */

/**
 * The tenant connects as `default`; blaze connects as `blazeadmin`.
 *
 * They are separate accounts because suspension switches `default` off — sharing one
 * account would mean locking blaze out of the container it still has to read stats from
 * and eventually resume.
 */
const TENANT_USER = "default";

function connect(adminUrl: string): Redis {
	return new Redis(adminUrl, {
		connectTimeout: 10_000,
		commandTimeout: 10_000,
		// The certificate is self-signed and generated on the box; the hop is encrypted but
		// there is no chain to validate. This becomes a real check once a publicly trusted
		// wildcard certificate replaces it — see DEPLOY.md.
		tls: { rejectUnauthorized: false },
		maxRetriesPerRequest: 1,
		// Fail fast: every caller here is a request path, not a long-lived worker.
		retryStrategy: () => null,
		lazyConnect: true,
	});
}

async function withRedis<T>(adminUrl: string, fn: (client: Redis) => Promise<T>): Promise<T> {
	const client = connect(adminUrl);
	try {
		await client.connect();
		return await fn(client);
	} finally {
		client.disconnect();
	}
}

/**
 * Confirm the tenant's container is actually serving before its connection string is
 * handed out.
 *
 * There is no `CREATE DATABASE` to run — `dedicated.ts` has already created the container
 * with the tenant's password baked into its service definition. What this proves is that
 * the thing we are about to promise the caller exists and answers, which is the part a
 * container-based provision can get wrong.
 */
export async function provisionRedisDatabase(req: ProvisionRequest): Promise<void> {
	await withRedis(req.adminUrl, async (client) => {
		const reply = await client.ping();
		if (reply !== "PONG") throw new Error(`Redis did not answer PING: ${reply}`);
	});
}

/**
 * No-op by design.
 *
 * For every other engine this drops a database inside an instance that keeps running. A
 * dedicated tenant has no such object: deprovisioning *is* destroying the container, and
 * that is `releaseDedicatedInstance`, which the caller runs straight after this. Flushing
 * here would only add a way for teardown to fail against a container already on its way
 * out.
 */
export async function deprovisionRedisDatabase(
	_adminUrl: string,
	_dbName: string,
	_roleName: string,
): Promise<void> {}

/**
 * Deny access without touching data.
 *
 * `ACL SETUSER default off` leaves the account, its password and every key intact while
 * refusing authentication, so a tenant that frees space gets everything back exactly as
 * it was.
 */
export async function suspendRedisDatabase(adminUrl: string): Promise<void> {
	await withRedis(adminUrl, async (client) => {
		await client.acl("SETUSER", TENANT_USER, "off");
	});
}

/**
 * Re-enable the tenant.
 *
 * Verified rather than assumed: switching a user `off` preserves its password list, so
 * turning it back `on` restores the tenant's existing credentials. That matters because
 * this runs from the metrics sweep, which has the database row but not the plaintext
 * password to re-supply.
 */
export async function resumeRedisDatabase(adminUrl: string): Promise<void> {
	await withRedis(adminUrl, async (client) => {
		await client.acl("SETUSER", TENANT_USER, "on");
	});
}

/**
 * Rotate the tenant's password on the running container.
 *
 * `resetpass` clears the old password rather than adding to it — Redis users hold a *set*
 * of valid passwords, so appending would leave the previous one working and make the
 * rotation cosmetic.
 *
 * This takes effect immediately but lives only in memory: the container is started from a
 * service definition that carries the original password, so a restart would undo it. The
 * caller in `lib/provision/index.ts` persists the new password to that definition as well
 * — see `persistDedicatedPassword`.
 */
export async function resetRedisPassword(
	adminUrl: string,
	_roleName: string,
	password: string,
): Promise<void> {
	await withRedis(adminUrl, async (client) => {
		await client.acl("SETUSER", TENANT_USER, "resetpass", `>${password}`);
	});
}

/**
 * Size, connections and command count, from `INFO`.
 *
 * `used_memory` is the right number for the quota because memory *is* the storage for
 * this engine, and it is the same number `maxmemory` is compared against — so the figure
 * the dashboard shows is the one that will actually refuse a write.
 */
export async function readRedisStats(adminUrl: string, _dbName: string): Promise<EngineStats> {
	return withRedis(adminUrl, async (client) => {
		const info = await client.info();
		const field = (key: string): number => {
			const match = new RegExp(`^${key}:(\\d+)`, "m").exec(info);
			return match ? Number(match[1]) : 0;
		};

		return {
			sizeBytes: field("used_memory"),
			// Minus one: blaze's own connection is open right now and is not the tenant's.
			connections: Math.max(0, field("connected_clients") - 1),
			// Nearest analogue to a commit counter; the charts render deltas between samples.
			xactCommit: field("total_commands_processed"),
		};
	});
}

/**
 * No-op, and unlike Mongo's this one is not a concession.
 *
 * Hardening a shared instance means constraining tenants that share it. Here every tenant
 * has its own container, and the whole policy — TLS-only listener, memory quota, and a
 * `default` user stripped of CONFIG/ACL/REPLICAOF so it can neither rewrite its own quota
 * nor lock blaze out — is applied by the image at startup, on every container, before any
 * connection is possible. There is nothing left for a one-time step to do.
 */
export async function hardenRedisInstance(_adminUrl: string): Promise<void> {}

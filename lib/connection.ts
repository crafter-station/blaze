import "server-only";
import { decryptSecret } from "./crypto";
import { ENGINE_CONFIG, type Engine } from "./engines/types";
import { env } from "./env";

/**
 * Builds the connection string a tenant actually uses.
 *
 * The rule this file exists to enforce: **hostnames, never IP addresses**. A connection
 * string is permanent — the moment someone pastes it into production we can never change
 * it — so every database is addressed through DNS we control. That costs one record per
 * engine today and is what makes moving hosts, adding nodes, or putting a proxy in front
 * a config change rather than a breaking change for every customer.
 *
 * The inherited `db.crafter.run` scheme handed out `<vps-ip>:<port>` from a pool of
 * 5433-5999, which caps the product at 567 databases forever and welds it to one machine.
 *
 * Two addressing shapes:
 *
 * - shared    — every tenant shares one host and port; the database name selects the
 *               tenant. `pg.blaze.run:5432/db_myapp_x7f2`
 * - dedicated — each tenant has its own container, so the *hostname* selects the tenant
 *               and Traefik routes by SNI. `myapp-x7f2.redis.blaze.run:6379`
 *
 * Both are stable across container moves and node additions.
 */

export interface ConnectionTarget {
	engine: Engine;
	slug: string;
	dbName: string;
	roleName: string;
	passwordEnc: string;
}

/** The host a tenant connects to. Never an IP. */
export function connectionHost(engine: Engine, slug: string): string {
	const { tenancy, hostPrefix } = ENGINE_CONFIG[engine];
	const base = `${hostPrefix}.${env.BLAZE_DOMAIN}`;
	return tenancy === "shared" ? base : `${slug}.${base}`;
}

export function connectionPort(engine: Engine): number {
	return ENGINE_CONFIG[engine].port;
}

/**
 * @param reveal when false the password is replaced with a placeholder, for logs, audit
 *        entries and any UI that shows the string before the user asks to unmask it.
 */
export function buildConnectionString(target: ConnectionTarget, reveal = true): string {
	const { engine, slug, dbName, roleName, passwordEnc } = target;
	const { urlScheme } = ENGINE_CONFIG[engine];
	const host = connectionHost(engine, slug);
	const port = connectionPort(engine);
	const password = reveal ? encodeURIComponent(decryptSecret(passwordEnc)) : "••••••••";
	const user = encodeURIComponent(roleName);

	switch (engine) {
		case "postgres":
			return `${urlScheme}://${user}:${password}@${host}:${port}/${dbName}?sslmode=require`;

		case "mysql":
		case "mariadb":
			return `${urlScheme}://${user}:${password}@${host}:${port}/${dbName}?ssl-mode=REQUIRED`;

		case "mongo":
			// authSource pins auth to the tenant's own database — without it the driver
			// authenticates against `admin`, which tenants have no access to.
			return `${urlScheme}://${user}:${password}@${host}:${port}/${dbName}?tls=true&authSource=${dbName}`;

		case "redis":
			// Redis has no username in the default ACL; `rediss` is the TLS scheme.
			return `rediss://:${password}@${host}:${port}`;

		case "libsql":
			return `libsql://${host}?authToken=${password}`;
	}
}

/**
 * Internal address blaze itself uses to administer an instance. Goes over the private
 * network, is never shown to a user, and is deliberately not the public hostname.
 */
export function adminConnectionString(
	engine: Engine,
	internalHost: string,
	port: number,
	adminUser: string,
	adminPasswordEnc: string,
	database?: string,
): string {
	const { urlScheme } = ENGINE_CONFIG[engine];
	const password = encodeURIComponent(decryptSecret(adminPasswordEnc));
	const user = encodeURIComponent(adminUser);

	if (engine === "redis") return `redis://:${password}@${internalHost}:${port}`;
	if (engine === "libsql") return `http://${internalHost}:${port}`;

	return `${urlScheme}://${user}:${password}@${internalHost}:${port}/${database ?? "postgres"}`;
}

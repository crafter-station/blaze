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
	/** Globally unique. Required because it, not the slug, separates dedicated tenants. */
	id: string;
	slug: string;
	dbName: string;
	roleName: string;
	passwordEnc: string;
}

/**
 * DNS label identifying one dedicated tenant's own container.
 *
 * Slugs are unique per *project*, so two different users can both own `myapp`. For a
 * shared engine that is harmless — the database name selects the tenant. For a dedicated
 * engine the *hostname* selects the tenant, so a slug-only label would route one user's
 * traffic into another user's database. The database id is the only globally unique
 * handle we have, so it carries the guarantee; the slug rides along to keep the string
 * readable, exactly as Neon's `ep-cool-darkness-123456` does.
 */
export function dedicatedLabel(slug: string, databaseId: string): string {
	return `${slug}-${databaseId.replace(/^[a-z]+_/, "")}`.slice(0, 63);
}

/** The host a tenant connects to. Never an IP. */
export function connectionHost(engine: Engine, slug: string, databaseId: string): string {
	const { tenancy, hostPrefix } = ENGINE_CONFIG[engine];
	const base = `${hostPrefix}.${env.BLAZE_DOMAIN}`;
	return tenancy === "shared" ? base : `${dedicatedLabel(slug, databaseId)}.${base}`;
}

export function connectionPort(engine: Engine): number {
	return ENGINE_CONFIG[engine].port;
}

/**
 * @param reveal when false the password is replaced with a placeholder, for logs, audit
 *        entries and any UI that shows the string before the user asks to unmask it.
 */
export function buildConnectionString(target: ConnectionTarget, reveal = true): string {
	const { engine, id, slug, dbName, roleName, passwordEnc } = target;
	const { urlScheme } = ENGINE_CONFIG[engine];
	const host = connectionHost(engine, slug, id);
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
			// The tenant is the `default` user, which takes no name in the URL. `rediss` is
			// the TLS scheme, and the listener refuses plaintext outright.
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

	// `blazeadmin`, never the tenant's `default` user: suspending a tenant switches
	// `default` off, and sharing that account would lock blaze out of the container it
	// still has to read stats from and eventually resume.
	if (engine === "redis") return `rediss://${user}:${password}@${internalHost}:${port}`;
	if (engine === "libsql") return `http://${internalHost}:${port}`;

	// `no-verify` rather than `require`: the instance presents a self-signed certificate
	// that blaze generated on the instance itself, so there is no chain to validate against
	// — but the connection is still encrypted. Once a publicly trusted certificate is in
	// place this becomes `verify-full`. Plain `require` is avoided deliberately: node-postgres
	// currently treats it as `verify-full`, which would fail against our own certificate.
	const db = database ?? "postgres";
	return `${urlScheme}://${user}:${password}@${internalHost}:${port}/${db}?sslmode=no-verify`;
}

/**
 * Connection string blaze uses to run a tenant's own SQL on their behalf.
 *
 * Uses the tenant's role and password, **never** the instance admin. This is the whole
 * security model of the SQL editor: queries run with exactly the privileges that role has,
 * so the isolation already proven for direct connections — no reaching another tenant's
 * database, no maintenance database, statement timeout and connection limit applied —
 * holds identically here. Running editor queries as the admin superuser would turn a
 * convenience feature into a complete tenancy bypass, and `COPY ... FROM PROGRAM` into
 * remote code execution on the instance.
 *
 * Goes over the internal host so the traffic stays on the Docker network rather than
 * leaving the box and coming back. `no-verify` because the instance certificate is
 * self-signed; the hop is still encrypted, and the server refuses plaintext.
 */
export function tenantInternalConnectionString(
	engine: Engine,
	internalHost: string,
	port: number,
	dbName: string,
	roleName: string,
	passwordEnc: string,
): string {
	const { urlScheme } = ENGINE_CONFIG[engine];
	const password = encodeURIComponent(decryptSecret(passwordEnc));
	const user = encodeURIComponent(roleName);
	return `${urlScheme}://${user}:${password}@${internalHost}:${port}/${dbName}?sslmode=no-verify`;
}

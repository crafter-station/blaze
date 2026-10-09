import type { Engine } from "./engines/types";

/**
 * Development-only redirect for tenant connections.
 *
 * Lets a local control database hold realistic instance rows (`blaze-pg-1:5433`) while
 * the console actually talks to the engines in `docker-compose.dev.yaml`:
 *
 *   TENANT_HOST_OVERRIDE=127.0.0.1
 *   TENANT_PORT_OVERRIDE=postgres=54321,mysql=33061,mariadb=33062,libsql=58080,redis=63791,mongo=27018
 *
 * Ignored entirely when `NODE_ENV` is `production`. That check is the whole safety story:
 * in a production build Next inlines `NODE_ENV`, so the branch below is dead code and no
 * environment variable can redirect a tenant's credentials to another host.
 */

export interface ConnectionTarget {
	host: string;
	port: number;
}

export function parsePortOverride(raw: string | undefined, engine: Engine): number | null {
	if (!raw) return null;
	for (const pair of raw.split(",")) {
		const [name, value] = pair.split("=").map((part) => part.trim());
		if (name !== engine) continue;
		const port = Number(value);
		return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
	}
	return null;
}

export function resolveTenantTarget(
	engine: Engine,
	target: ConnectionTarget,
	environment: Record<string, string | undefined> = process.env,
): ConnectionTarget {
	if (environment.NODE_ENV === "production") return target;
	const host = environment.TENANT_HOST_OVERRIDE?.trim();
	const port = parsePortOverride(environment.TENANT_PORT_OVERRIDE, engine);
	return { host: host || target.host, port: port ?? target.port };
}

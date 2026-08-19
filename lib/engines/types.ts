/**
 * The six database engines blaze offers, and how each one is made multi-tenant.
 *
 * See PLAN.md §2 (Q13). Two tenancy models:
 *
 * - `shared`    — one big engine instance holds many tenants. Creating a database is
 *                 `CREATE DATABASE` + a scoped role: ~200ms, near-zero marginal RAM.
 * - `dedicated` — one container per tenant, provisioned through Dokploy. Used where the
 *                 engine has no trustworthy in-process tenancy story.
 *
 * Redis is `dedicated` deliberately: its ACLs cannot contain a tenant. `FLUSHALL`,
 * `FLUSHDB` and `SWAPDB` take no key arguments and so bypass key patterns entirely, and
 * there is no per-user memory limit — one tenant can OOM every other tenant. A Redis
 * container idles at ~5-10MB, so dedicated is affordable here in a way it is not for
 * Postgres (~100MB).
 */

export type Engine = "postgres" | "mysql" | "mariadb" | "mongo" | "redis" | "libsql";

export const ENGINES: Engine[] = ["postgres", "mysql", "mariadb", "mongo", "redis", "libsql"];

export type Tenancy = "shared" | "dedicated";

export interface EngineConfig {
	/** Display name in the dashboard. */
	label: string;
	/** How tenants are separated. */
	tenancy: Tenancy;
	/** Subdomain this engine is reached on, e.g. `pg` -> `pg.blaze.run`. */
	hostPrefix: string;
	/** Port clients connect to. */
	port: number;
	/** Connection-string scheme. */
	urlScheme: string;
	/**
	 * Whether the SQL editor and table browser are available (PLAN.md Q18).
	 * Mongo and Redis need bespoke consoles and ship in v1.1.
	 */
	hasSql: boolean;
	/** Image used when provisioning a dedicated container. */
	image: string;
	/** Dokploy's primary-key field name, for dedicated engines. */
	dokployIdKey: string;
}

export const ENGINE_CONFIG: Record<Engine, EngineConfig> = {
	postgres: {
		label: "PostgreSQL",
		tenancy: "shared",
		hostPrefix: "pg",
		// Not 5432: Dokploy's own Postgres already holds that port on the host, so binding
		// the shared tenant instance there returns a conflict. This is a property of the
		// engine, not of one instance — every tenant on `pg.blaze.crafter.run` uses it, and
		// it is baked into permanent connection strings. Changing it later breaks every
		// customer, so it moves only behind the SNI proxy (PLAN.md Q12, option c), which
		// terminates on the standard port and routes by hostname.
		port: 5433,
		urlScheme: "postgresql",
		hasSql: true,
		image: "postgres:18",
		dokployIdKey: "postgresId",
	},
	mysql: {
		label: "MySQL",
		tenancy: "shared",
		hostPrefix: "mysql",
		port: 3306,
		urlScheme: "mysql",
		hasSql: true,
		image: "mysql:8",
		dokployIdKey: "mysqlId",
	},
	mariadb: {
		label: "MariaDB",
		tenancy: "shared",
		hostPrefix: "mariadb",
		port: 3306,
		urlScheme: "mariadb",
		hasSql: true,
		image: "mariadb:11",
		dokployIdKey: "mariadbId",
	},
	mongo: {
		label: "MongoDB",
		tenancy: "shared",
		hostPrefix: "mongo",
		port: 27017,
		urlScheme: "mongodb",
		hasSql: false,
		image: "mongo:8",
		dokployIdKey: "mongoId",
	},
	redis: {
		label: "Redis",
		tenancy: "dedicated",
		hostPrefix: "redis",
		port: 6379,
		urlScheme: "redis",
		hasSql: false,
		image: "redis:8",
		dokployIdKey: "redisId",
	},
	libsql: {
		label: "libSQL",
		// Dedicated until the sqld namespace spike lands — see PLAN.md §8.
		tenancy: "dedicated",
		hostPrefix: "libsql",
		port: 8080,
		urlScheme: "http",
		hasSql: true,
		image: "ghcr.io/tursodatabase/libsql-server:v0.24.32",
		dokployIdKey: "libsqlId",
	},
};

export function isEngine(value: string): value is Engine {
	return (ENGINES as string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * Query surface, shared by all six drivers.
 * ------------------------------------------------------------------ */

export interface QueryResult {
	columns: string[];
	rows: Record<string, unknown>[];
	rowCount: number;
}

export interface TableInfo {
	name: string;
	schema?: string;
	type: "table" | "view" | "collection";
}

export interface ColumnInfo {
	name: string;
	type: string;
	nullable: boolean;
	defaultValue?: string;
	isPrimaryKey?: boolean;
}

export interface DatabaseConnection {
	query(sql: string): Promise<QueryResult>;
	getSchemas(): Promise<string[]>;
	getTables(schema?: string): Promise<TableInfo[]>;
	getColumns(table: string, schema?: string): Promise<ColumnInfo[]>;
	getTableData(
		table: string,
		schema?: string,
		limit?: number,
		offset?: number,
	): Promise<QueryResult>;
	close(): Promise<void>;
}

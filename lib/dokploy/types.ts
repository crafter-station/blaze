import { ENGINE_CONFIG, type Engine } from "@/lib/engines/types";

/**
 * Dokploy speaks the same six engine names blaze does, so `DatabaseType` is an alias
 * rather than a parallel vocabulary that can drift. Engine facts live in
 * `lib/engines/types.ts`; only Dokploy-specific endpoint quirks live here.
 */
export type DatabaseType = Engine;

export type ServiceStatus = "idle" | "running" | "done" | "error";

/** Dokploy uses a plural endpoint name for libsql only. */
const SAVE_PORT_ENDPOINT: Record<Engine, string> = {
	postgres: "postgres.saveExternalPort",
	mysql: "mysql.saveExternalPort",
	mariadb: "mariadb.saveExternalPort",
	mongo: "mongo.saveExternalPort",
	redis: "redis.saveExternalPort",
	libsql: "libsql.saveExternalPorts",
};

export const DB_CONFIG = Object.fromEntries(
	(Object.keys(ENGINE_CONFIG) as Engine[]).map((engine) => [
		engine,
		{
			idKey: ENGINE_CONFIG[engine].dokployIdKey,
			label: ENGINE_CONFIG[engine].label,
			urlScheme: ENGINE_CONFIG[engine].urlScheme,
			hasSql: ENGINE_CONFIG[engine].hasSql,
			savePortEndpoint: SAVE_PORT_ENDPOINT[engine],
		},
	]),
) as Record<
	Engine,
	{ idKey: string; label: string; urlScheme: string; hasSql: boolean; savePortEndpoint: string }
>;

/** Raw response from project.all — same shape as project.one but with minimal service refs */
export interface ProjectSummary {
	projectId: string;
	name: string;
	description: string | null;
	createdAt: string;
	organizationId: string;
	env: string | null;
	environments: ProjectEnvironment[];
}

export interface ProjectEnvironment {
	environmentId: string;
	name: string;
	isDefault?: boolean;
	applications: { applicationId: string; name: string; applicationStatus: ServiceStatus }[];
	postgres: { postgresId: string }[];
	mysql: { mysqlId: string }[];
	mariadb: { mariadbId: string }[];
	mongo: { mongoId: string }[];
	redis: { redisId: string }[];
	compose: { composeId: string; name: string; composeStatus: ServiceStatus }[];
	libsql: { libsqlId: string }[];
}

export interface Project {
	projectId: string;
	name: string;
	description: string | null;
	createdAt: string;
	organizationId: string;
	env: string | null;
	environments: Environment[];
}

export interface Environment {
	environmentId: string;
	name: string;
	projectId: string;
	description: string | null;
	createdAt: string;
	applications: ApplicationDetail[];
	postgres: DatabaseDetail[];
	mysql: DatabaseDetail[];
	mariadb: DatabaseDetail[];
	mongo: DatabaseDetail[];
	redis: DatabaseDetail[];
	libsql: DatabaseDetail[];
	compose: ComposeDetail[];
}

export interface ApplicationDetail {
	applicationId: string;
	name: string;
	appName: string;
	applicationStatus: ServiceStatus;
	description: string | null;
	dockerImage: string | null;
	createdAt: string;
}

export interface DatabaseDetail {
	postgresId?: string;
	mysqlId?: string;
	mariadbId?: string;
	redisId?: string;
	mongoId?: string;
	libsqlId?: string;
	name: string;
	appName: string;
	applicationStatus: ServiceStatus;
	description: string | null;
	databaseName?: string;
	databaseUser?: string;
	databasePassword?: string;
	databaseRootPassword?: string;
	dockerImage: string;
	externalPort?: number | null;
	createdAt: string;
	environmentId: string;
}

export interface ComposeDetail {
	composeId: string;
	name: string;
	appName: string;
	composeStatus: ServiceStatus;
	description: string | null;
	createdAt: string;
}

export interface MonitoringData {
	cpu: MetricPoint[];
	memory: MetricPoint[];
	disk: MetricPoint[];
	network: MetricPoint[];
	block: MetricPoint[];
}

export interface MetricPoint {
	value: number;
	timestamp: string;
}

/** Normalized database info across all types */
export interface DatabaseInfo {
	id: string;
	type: DatabaseType;
	name: string;
	appName: string;
	status: ServiceStatus;
	databaseName?: string;
	databaseUser?: string;
	databasePassword?: string;
	externalPort?: number | null;
	dockerImage: string;
	createdAt: string;
	environmentId: string;
}

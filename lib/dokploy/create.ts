import { ENGINES as DATABASE_TYPES } from "@/lib/engines/types";
import { dokployGet, dokployPost } from "./client";
import { type DatabaseType, DB_CONFIG } from "./types";

/** Generate a Docker-safe appName: lowercase alphanumeric + hyphens */
export function generateAppName(projectName: string, dbName: string): string {
	const base = `${projectName}-${dbName}`
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	const suffix = Math.random().toString(36).substring(2, 8);
	return `${base}-${suffix}`;
}

/** Generate a random password: 16 chars, lowercase + digits (matches VPS CLI) */
export function generatePassword(length = 16): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** Default docker images per database type (matches VPS CLI) */
export const DEFAULT_DOCKER_IMAGES: Record<DatabaseType, string> = {
	postgres: "postgres:18",
	mysql: "mysql:8",
	mariadb: "mariadb:11",
	redis: "redis:8",
	mongo: "mongo:8",
	libsql: "ghcr.io/tursodatabase/libsql-server:v0.24.32",
};

/** Default database user per type (matches VPS CLI) */
export const DEFAULT_USERS: Record<DatabaseType, string> = {
	postgres: "postgres",
	mysql: "mysql",
	mariadb: "mariadb",
	redis: "",
	mongo: "mongo",
	libsql: "libsql",
};

const PORT_MIN = 5433;
const PORT_MAX = 5999;

/** Collect all external ports already in use by any database service (matches VPS CLI logic) */
async function getUsedPorts(): Promise<Set<number>> {
	const idsByType = await Promise.all(
		DATABASE_TYPES.map((type) =>
			dokployGet<{ items: Record<string, unknown>[] }>(`${type}.search`, { limit: "100" })
				.then((r) => (r?.items ?? []).map((i) => i[`${type}Id`] as string))
				.catch(() => [] as string[]),
		),
	);

	const fetches: Promise<number | null>[] = [];
	for (let i = 0; i < DATABASE_TYPES.length; i++) {
		const type = DATABASE_TYPES[i];
		for (const id of idsByType[i]) {
			fetches.push(
				dokployGet<{ externalPort?: number | null }>(`${type}.one`, {
					[`${type}Id`]: id,
				})
					.then((d) => d?.externalPort ?? null)
					.catch(() => null),
			);
		}
	}

	const ports = await Promise.all(fetches);
	return new Set(ports.filter((p): p is number => p !== null && p > 0));
}

/** Pick a random port in 5433-5999 that is not already used by any DB */
export async function findAvailablePort(): Promise<number> {
	const used = await getUsedPorts();
	const available: number[] = [];
	for (let p = PORT_MIN; p <= PORT_MAX; p++) {
		if (!used.has(p)) available.push(p);
	}
	if (available.length === 0) {
		throw new Error("No available ports in range 5433-5999");
	}
	return available[Math.floor(Math.random() * available.length)];
}

/** Which fields each database type requires */
export const TYPE_FIELDS: Record<
	DatabaseType,
	{ hasDatabaseName: boolean; hasDatabaseUser: boolean; hasRootPassword: boolean }
> = {
	postgres: { hasDatabaseName: true, hasDatabaseUser: true, hasRootPassword: false },
	mysql: { hasDatabaseName: true, hasDatabaseUser: true, hasRootPassword: true },
	mariadb: { hasDatabaseName: true, hasDatabaseUser: true, hasRootPassword: true },
	redis: { hasDatabaseName: false, hasDatabaseUser: false, hasRootPassword: false },
	mongo: { hasDatabaseName: false, hasDatabaseUser: true, hasRootPassword: false },
	libsql: { hasDatabaseName: true, hasDatabaseUser: true, hasRootPassword: false },
};

export interface CreateDatabaseParams {
	name: string;
	appName?: string;
	environmentId: string;
	databaseName?: string;
	databaseUser?: string;
	databasePassword: string;
	databaseRootPassword?: string;
	dockerImage?: string;
	description?: string;
}

function buildCreateBody(
	type: DatabaseType,
	params: CreateDatabaseParams,
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		name: params.name,
		...(params.appName ? { appName: params.appName } : {}),
		environmentId: params.environmentId,
		dockerImage: params.dockerImage || DEFAULT_DOCKER_IMAGES[type],
		...(params.description ? { description: params.description } : {}),
	};

	switch (type) {
		case "postgres":
		case "libsql":
			return {
				...base,
				databaseName: params.databaseName,
				databaseUser: params.databaseUser,
				databasePassword: params.databasePassword,
			};
		case "mysql":
		case "mariadb":
			return {
				...base,
				databaseName: params.databaseName,
				databaseUser: params.databaseUser,
				databasePassword: params.databasePassword,
				databaseRootPassword: params.databaseRootPassword,
			};
		case "redis":
			return {
				...base,
				databasePassword: params.databasePassword,
			};
		case "mongo":
			return {
				...base,
				databaseUser: params.databaseUser,
				databasePassword: params.databasePassword,
			};
	}
}

export async function createProject(
	name: string,
	description?: string,
): Promise<{ projectId: string }> {
	return dokployPost<{ projectId: string }>("project.create", {
		name,
		...(description ? { description } : {}),
	});
}

export async function createDatabase(
	type: DatabaseType,
	params: CreateDatabaseParams,
): Promise<{ id: string }> {
	const body = buildCreateBody(type, params);
	const result = await dokployPost<Record<string, unknown>>(`${type}.create`, body);
	const idKey = DB_CONFIG[type].idKey;
	const id = result[idKey] as string;
	return { id };
}

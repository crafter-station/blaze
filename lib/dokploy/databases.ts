import "server-only";
import { ENGINE_CONFIG, type Engine } from "@/lib/engines/types";
import { dokployGet, dokployPost } from "./client";
import type { DatabaseDetail, DatabaseInfo } from "./types";

/**
 * Container lifecycle for **dedicated** engines only (redis, libsql).
 *
 * Ported from db.crafter.run, with one deliberate removal: the original built connection
 * URLs here as `<vps-ip>:<external-port>`. blaze never hands out an IP — connection
 * strings are built in `lib/connection.ts` from DNS we control, so that moving a
 * container or adding a node doesn't break a customer's config. Dropping the function
 * rather than leaving it unused keeps the invariant structural instead of a comment
 * somebody has to remember.
 *
 * Shared engines (postgres, mysql, mariadb, mongo) never reach this file: their databases
 * are created with `CREATE DATABASE` inside an already-running instance, not by asking
 * Dokploy for a container.
 */

function extractId(engine: Engine, detail: DatabaseDetail): string {
	const key = ENGINE_CONFIG[engine].dokployIdKey;
	return (detail as unknown as Record<string, unknown>)[key] as string;
}

export function normalizeDatabaseDetail(engine: Engine, detail: DatabaseDetail): DatabaseInfo {
	return {
		id: extractId(engine, detail),
		type: engine,
		name: detail.name,
		appName: detail.appName,
		status: detail.applicationStatus,
		databaseName: detail.databaseName,
		databaseUser: detail.databaseUser,
		databasePassword: detail.databasePassword,
		externalPort: detail.externalPort,
		dockerImage: detail.dockerImage,
		createdAt: detail.createdAt,
		environmentId: detail.environmentId,
	};
}

export async function getDatabase(engine: Engine, id: string): Promise<DatabaseInfo> {
	const idKey = ENGINE_CONFIG[engine].dokployIdKey;
	const detail = await dokployGet<DatabaseDetail>(`${engine}.one`, { [idKey]: id });
	return normalizeDatabaseDetail(engine, detail);
}

export async function deployDatabase(engine: Engine, id: string): Promise<void> {
	await dokployPost(`${engine}.deploy`, { [ENGINE_CONFIG[engine].dokployIdKey]: id });
}

export async function startDatabase(engine: Engine, id: string): Promise<void> {
	await dokployPost(`${engine}.start`, { [ENGINE_CONFIG[engine].dokployIdKey]: id });
}

export async function stopDatabase(engine: Engine, id: string): Promise<void> {
	await dokployPost(`${engine}.stop`, { [ENGINE_CONFIG[engine].dokployIdKey]: id });
}

export async function removeDatabase(engine: Engine, id: string): Promise<void> {
	await dokployPost(`${engine}.remove`, { [ENGINE_CONFIG[engine].dokployIdKey]: id });
}

import "server-only";
import { buildConnectionString, connectionHost, connectionPort } from "@/lib/connection";
import type { Database, Project } from "@/lib/control/schema";

/**
 * Wire shapes for `/v1`.
 *
 * These exist so the API surface is decided in one place rather than emerging from
 * whatever each route happens to select. In particular `passwordEnc`, `instanceId` and
 * `ownerUserId` are never serialised: the first is a secret, and the other two describe
 * blaze's internals, which would become an accidental contract the moment a caller
 * started reading them.
 */

export interface DatabaseDTO {
	id: string;
	name: string;
	slug: string;
	engine: string;
	status: string;
	host: string;
	port: number;
	database: string;
	role: string;
	size_bytes: number;
	expires_at: string | null;
	created_at: string;
	created_via: string;
	project_id: string;
	/** Included only where the caller explicitly needs credentials. */
	connection_string?: string;
}

export function serializeDatabase(record: Database, withSecret = false): DatabaseDTO {
	const dto: DatabaseDTO = {
		id: record.id,
		name: record.name,
		slug: record.slug,
		engine: record.engine,
		status: record.status,
		host: connectionHost(record.engine, record.slug),
		port: connectionPort(record.engine),
		database: record.dbName,
		role: record.roleName,
		size_bytes: record.sizeBytes,
		expires_at: record.expiresAt?.toISOString() ?? null,
		created_at: record.createdAt.toISOString(),
		created_via: record.createdVia,
		project_id: record.projectId,
	};

	if (withSecret) {
		dto.connection_string = buildConnectionString({
			engine: record.engine,
			slug: record.slug,
			dbName: record.dbName,
			roleName: record.roleName,
			passwordEnc: record.passwordEnc,
		});
	}

	return dto;
}

export interface ProjectDTO {
	id: string;
	name: string;
	slug: string;
	created_at: string;
}

export function serializeProject(project: Project): ProjectDTO {
	return {
		id: project.id,
		name: project.name,
		slug: project.slug,
		created_at: project.createdAt.toISOString(),
	};
}

import { PROVISIONABLE } from "@/lib/engines/available";
import type { Engine } from "@/lib/engines/types";
import {
	deprovisionMysqlDatabase,
	hardenMysqlInstance,
	provisionMysqlDatabase,
	readMysqlStats,
	resetMysqlPassword,
	resumeMysqlDatabase,
	suspendMysqlDatabase,
} from "./mysql";
import {
	deprovisionPostgresDatabase,
	hardenPostgresInstance,
	provisionPostgresDatabase,
	readPostgresStats,
	resetPostgresPassword,
	resumePostgresDatabase,
	suspendPostgresDatabase,
} from "./postgres";

/**
 * Per-engine operations, behind one interface.
 *
 * A registry rather than `if (engine === "postgres")` scattered across provisioning,
 * metrics, suspension and password rotation. Those branches drift: the day someone adds
 * an engine and updates four of five call sites, the fifth fails at runtime for one
 * engine only. Here an engine is either in the table with every operation implemented, or
 * it is not supported at all — and the type checker enforces that.
 *
 * MariaDB deliberately reuses the MySQL implementation. It speaks the same wire protocol
 * and the same DDL; a parallel copy would be identical code with an independent set of
 * future bugs.
 */

export interface ProvisionRequest {
	adminUrl: string;
	dbName: string;
	roleName: string;
	password: string;
}

export interface EngineStats {
	sizeBytes: number;
	connections: number;
	xactCommit: number;
}

export interface EngineOps {
	provision(request: ProvisionRequest): Promise<void>;
	deprovision(adminUrl: string, dbName: string, roleName: string): Promise<void>;
	/** Block access without destroying data. */
	suspend(adminUrl: string, dbName: string, roleName: string): Promise<void>;
	resume(adminUrl: string, dbName: string, roleName: string): Promise<void>;
	resetPassword(adminUrl: string, roleName: string, password: string): Promise<void>;
	readStats(adminUrl: string, dbName: string): Promise<EngineStats>;
	/** One-time instance setup, run at bootstrap. Must be idempotent. */
	harden(adminUrl: string): Promise<void>;
}

const POSTGRES: EngineOps = {
	provision: provisionPostgresDatabase,
	deprovision: deprovisionPostgresDatabase,
	suspend: suspendPostgresDatabase,
	resume: resumePostgresDatabase,
	resetPassword: resetPostgresPassword,
	readStats: readPostgresStats,
	harden: hardenPostgresInstance,
};

const MYSQL: EngineOps = {
	provision: provisionMysqlDatabase,
	deprovision: deprovisionMysqlDatabase,
	// MySQL locks the account rather than revoking a grant, so the database name is unused.
	suspend: (adminUrl, _dbName, roleName) => suspendMysqlDatabase(adminUrl, roleName),
	resume: (adminUrl, _dbName, roleName) => resumeMysqlDatabase(adminUrl, roleName),
	resetPassword: resetMysqlPassword,
	readStats: readMysqlStats,
	harden: hardenMysqlInstance,
};

/** Engines blaze can actually provision today. Absent here means "not yet". */
export const ENGINE_OPS: Partial<Record<Engine, EngineOps>> = {
	postgres: POSTGRES,
	mysql: MYSQL,
	mariadb: MYSQL,
};

export function isSupported(engine: Engine): boolean {
	return engine in ENGINE_OPS;
}

/*
 * `lib/engines/available.ts` carries the same list for the browser, which cannot import
 * this module (it pulls in database drivers). This asserts at module load that the two
 * agree, so a mismatch surfaces on boot rather than as a create dialog offering an engine
 * the provisioner will reject.
 */
{
	const implemented = Object.keys(ENGINE_OPS).sort().join(",");
	const advertised = [...PROVISIONABLE].sort().join(",");
	if (implemented !== advertised) {
		throw new Error(
			`Engine lists disagree: provisioner has [${implemented}], UI advertises [${advertised}]`,
		);
	}
}

export function opsFor(engine: Engine): EngineOps {
	const ops = ENGINE_OPS[engine];
	if (!ops) throw new Error(`Provisioning for ${engine} is not implemented yet`);
	return ops;
}

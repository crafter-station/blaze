import "server-only";
import type { Database, Instance } from "./control/schema";
import { LIMITS } from "./limits";
import { connectTenant } from "./tenant-db";

/**
 * Runs a tenant's SQL as that tenant.
 *
 * Every protection here is one the engine already enforces for that role — statement or
 * execution timeouts, connection limits, and the role's grants — rather than something
 * this file invents. That is deliberate: a check that exists only in application code is
 * a check a second call site can forget.
 */

/** Rows returned to the caller. The full count is still reported. */
export const MAX_ROWS = 500;

export interface QueryOutcome {
	ok: boolean;
	error?: string;
	columns?: string[];
	rows?: unknown[][];
	rowCount?: number;
	truncated?: boolean;
	durationMs?: number;
	command?: string;
}

export async function runTenantQuery(
	record: Database & { instance: Instance },
	sql: string,
): Promise<QueryOutcome> {
	const trimmed = sql.trim();
	if (!trimmed) return { ok: false, error: "Nothing to run" };

	const started = Date.now();
	let connection: Awaited<ReturnType<typeof connectTenant>> | null = null;

	try {
		connection = await connectTenant(record, LIMITS.STATEMENT_TIMEOUT_MS + 5_000);
		const result = await connection.query(trimmed);

		return {
			ok: true,
			columns: result.columns,
			rows: result.rows.slice(0, MAX_ROWS),
			rowCount: result.rowCount,
			truncated: result.rows.length > MAX_ROWS,
			command: result.command,
			durationMs: Date.now() - started,
		};
	} catch (error) {
		// The engine's own message is the single most useful thing an editor can show, so
		// it is passed through rather than replaced with something generic. It describes the
		// tenant's own database and leaks nothing about the instance or other tenants.
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Query failed",
			durationMs: Date.now() - started,
		};
	} finally {
		await connection?.close();
	}
}

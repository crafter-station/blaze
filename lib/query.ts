import "server-only";
import { Client, type FieldDef, type QueryResult } from "pg";
import { tenantInternalConnectionString } from "./connection";
import type { Database, Instance } from "./control/schema";

/**
 * Runs a tenant's SQL as that tenant.
 *
 * Every protection here is one the database already enforces for the role, rather than
 * something this file invents: `statement_timeout` stops runaway queries, `CONNECTION
 * LIMIT` caps concurrency, and the role's grants stop it reaching anything that is not
 * its own database. That is deliberate — a check that only exists in application code is
 * a check that a second call site can forget.
 */

/** Rows returned to the browser. The full count is still reported. */
export const MAX_ROWS = 500;

export interface QueryOutcome {
	ok: boolean;
	error?: string;
	columns?: string[];
	rows?: unknown[][];
	rowCount?: number;
	truncated?: boolean;
	durationMs?: number;
	/** e.g. "CREATE TABLE" — the only feedback a non-SELECT statement gives. */
	command?: string;
}

export async function runTenantQuery(
	record: Database & { instance: Instance },
	sql: string,
): Promise<QueryOutcome> {
	const trimmed = sql.trim();
	if (!trimmed) return { ok: false, error: "Nothing to run" };

	const client = new Client({
		connectionString: tenantInternalConnectionString(
			record.engine,
			record.instance.internalHost,
			record.instance.port,
			record.dbName,
			record.roleName,
			record.passwordEnc,
		),
		connectionTimeoutMillis: 10_000,
		// Belt to the role's statement_timeout brace: that one stops the query server-side,
		// this one stops us holding a request open if the server never answers at all.
		query_timeout: 35_000,
	});

	const started = Date.now();

	try {
		await client.connect();
		const result = await client.query({ text: trimmed, rowMode: "array" });

		// node-postgres returns an array for multi-statement queries; the last one is what
		// the editor shows, matching how psql reports a batch.
		const last = (Array.isArray(result) ? result[result.length - 1] : result) as QueryResult;

		const rows = (last.rows ?? []) as unknown[][];
		return {
			ok: true,
			columns: last.fields?.map((f: FieldDef) => f.name) ?? [],
			rows: rows.slice(0, MAX_ROWS),
			rowCount: last.rowCount ?? rows.length,
			truncated: rows.length > MAX_ROWS,
			command: last.command,
			durationMs: Date.now() - started,
		};
	} catch (error) {
		// Postgres error messages are the single most useful thing an editor can show, so
		// they are passed through rather than replaced with something generic. They describe
		// the tenant's own database and leak nothing about the instance or other tenants.
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Query failed",
			durationMs: Date.now() - started,
		};
	} finally {
		await client.end().catch(() => {});
	}
}

import "server-only";
import type { Database, Instance } from "./control/schema";
import { LIMITS } from "./limits";
import { runMongoQuery } from "./mongo/query";
import type { StatementOutcome } from "./sql/types";
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
	/** Something the engine adapter wants the caller to know, e.g. that results were capped. */
	note?: string;
}

export async function runTenantQuery(
	record: Database & { instance: Instance },
	sql: string,
	options: { confirm?: boolean | string } = {},
): Promise<QueryOutcome> {
	const trimmed = sql.trim();
	if (!trimmed) return { ok: false, error: "Nothing to run" };

	// Mongo takes one mongosh-style command instead of SQL, through the Shell's own path.
	if (record.engine === "mongo") {
		return runMongoQuery(
			record as Parameters<typeof runMongoQuery>[0],
			trimmed,
			options.confirm ?? false,
		);
	}

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

/* ------------------------------------------------------------------ *
 * SQL console batches
 * ------------------------------------------------------------------ */

/** Hard cap on statements in one console run, so a paste of a dump cannot pin a connection. */
export const MAX_BATCH_STATEMENTS = 50;

/** Cells longer than this are cut before they cross the wire. */
const MAX_CELL_CHARS = 100_000;

function hex(bytes: Uint8Array): string {
	let out = "\\x";
	const limit = Math.min(bytes.length, MAX_CELL_CHARS / 2);
	for (let i = 0; i < limit; i++) out += bytes[i].toString(16).padStart(2, "0");
	return bytes.length > limit ? `${out}…` : out;
}

/**
 * Make one cell safe to serialise to the browser without losing what the engine said:
 * binary becomes Postgres-style `\x` hex, bigints become strings, JSON stays structured.
 */
export function normalizeCell(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "string") {
		return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value;
	}
	if (value instanceof Date)
		return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
	if (value instanceof Uint8Array) return hex(value);
	if (value instanceof ArrayBuffer) return hex(new Uint8Array(value));
	if (Array.isArray(value)) return value.map(normalizeCell);
	if (typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalizeCell(v)]),
		);
	}
	return value;
}

interface DriverError {
	message?: string;
	/** node-postgres: 1-based offset into the statement, as a string. */
	position?: string;
}

/**
 * Run statements one at a time on a single connection, as the tenant.
 *
 * One connection, so session state carries across the batch the way it does in psql:
 * `SET search_path`, temporary tables and an explicit `BEGIN … COMMIT` all behave. One
 * statement per round trip, so every statement gets its own result, timing and error.
 * Execution stops at the first failure; the rest are reported as skipped.
 */
export async function runTenantBatch(
	record: Database & { instance: Instance },
	statements: string[],
): Promise<StatementOutcome[]> {
	const outcomes: StatementOutcome[] = [];
	let connection: Awaited<ReturnType<typeof connectTenant>> | null = null;

	try {
		connection = await connectTenant(record, LIMITS.STATEMENT_TIMEOUT_MS + 5_000, {
			textValues: true,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Could not connect";
		return statements.map((_, index) => ({
			ok: false,
			skipped: index > 0,
			error: index === 0 ? message : undefined,
			columns: [],
			rows: [],
			rowCount: 0,
			truncated: false,
			durationMs: 0,
		}));
	}

	try {
		let failed = false;
		for (const sql of statements) {
			if (failed) {
				outcomes.push({
					ok: false,
					skipped: true,
					columns: [],
					rows: [],
					rowCount: 0,
					truncated: false,
					durationMs: 0,
				});
				continue;
			}
			const started = performance.now();
			try {
				const result = await connection.query(sql);
				outcomes.push({
					ok: true,
					columns: result.columns.map((name, i) => ({ name, type: result.columnTypes?.[i] })),
					rows: result.rows.slice(0, MAX_ROWS).map((row) => row.map(normalizeCell)),
					rowCount: result.rowCount,
					truncated: result.rows.length > MAX_ROWS,
					command: result.command,
					durationMs: Math.round(performance.now() - started),
				});
			} catch (error) {
				failed = true;
				const driver = error as DriverError;
				const position = Number(driver.position);
				outcomes.push({
					ok: false,
					error: error instanceof Error ? error.message : "Query failed",
					errorPosition: Number.isFinite(position) && position > 0 ? position : undefined,
					columns: [],
					rows: [],
					rowCount: 0,
					truncated: false,
					durationMs: Math.round(performance.now() - started),
				});
			}
		}
		return outcomes;
	} finally {
		await connection.close();
	}
}

import "server-only";
import type { Database, Instance } from "@/lib/control/schema";
import { LIMITS } from "@/lib/limits";
import { connectTenant } from "@/lib/tenant-db";
import { type PlanFormat, planFormat } from "./explain";
import { splitStatements } from "./split";
import type { SqlEngine } from "./types";

/**
 * EXPLAIN for one statement, as the tenant role.
 *
 * A plain EXPLAIN only plans. ANALYZE executes the statement to measure it, so it runs
 * inside a transaction that is always rolled back: writes made by the measured statement
 * are discarded. That is a courtesy, not a guarantee (sequences advance, functions with
 * side effects still run, and MySQL commits DDL implicitly), which is why the console
 * asks before analysing anything but a plain query.
 */

export type ExplainOutcome =
	| { ok: true; format: PlanFormat; raw: unknown; analyzed: boolean; durationMs: number }
	| { ok: false; error: string; errorPosition?: number };

export async function explainStatement(
	record: Database & { instance: Instance },
	statement: string,
	analyze: boolean,
): Promise<ExplainOutcome> {
	const engine = record.engine as SqlEngine;
	const sql = statement.trim().replace(/;+\s*$/, "");
	if (!sql) return { ok: false, error: "Nothing to explain" };
	// One statement only: the driver would happily run a second one after the EXPLAIN,
	// outside the plan and (for ANALYZE) after the rollback point.
	if (splitStatements(sql, engine).length > 1) {
		return { ok: false, error: "EXPLAIN takes a single statement. Select just one and try again." };
	}
	const doAnalyze = analyze && engine !== "libsql";

	const prefix =
		engine === "postgres"
			? `EXPLAIN (FORMAT JSON${doAnalyze ? ", ANALYZE, BUFFERS" : ""}) `
			: engine === "libsql"
				? "EXPLAIN QUERY PLAN "
				: engine === "mariadb" && doAnalyze
					? "ANALYZE FORMAT=JSON "
					: doAnalyze
						? "EXPLAIN ANALYZE "
						: "EXPLAIN FORMAT=JSON ";

	const started = performance.now();
	const connection = await connectTenant(record, LIMITS.STATEMENT_TIMEOUT_MS + 5_000);
	let inTransaction = false;
	try {
		if (doAnalyze) {
			await connection.query(engine === "postgres" ? "BEGIN" : "START TRANSACTION");
			inTransaction = true;
		}
		const result = await connection.query(prefix + sql);
		const raw = engine === "libsql" ? result.rows : result.rows[0]?.[0];
		return {
			ok: true,
			format: planFormat(engine, doAnalyze),
			raw,
			analyzed: doAnalyze,
			durationMs: Math.round(performance.now() - started),
		};
	} catch (error) {
		const position = Number((error as { position?: string }).position);
		return {
			ok: false,
			error: error instanceof Error ? error.message : "EXPLAIN failed",
			// Positions count from the start of what was sent, prefix included.
			errorPosition: position > prefix.length ? position - prefix.length : undefined,
		};
	} finally {
		if (inTransaction) await connection.query("ROLLBACK").catch(() => {});
		await connection.close();
	}
}

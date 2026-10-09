import "server-only";
import type { OwnedMongo } from "./access";
import { type EJsonValue, isObject } from "./literal";
import { runShell } from "./run";
import { topLevelColumns } from "./schema";
import type { ShellOutcome } from "./types";

/**
 * The `/v1` query endpoint and MCP `run_query` for a Mongo database: one mongosh-style
 * command in, the same tabular shape the SQL engines return out.
 *
 * It goes through exactly the Shell's path (parse, classify, run as the tenant), so the
 * same commands are refused and the same caps apply. There is no dialog to ask in, so a
 * command that needs confirmation runs only when the caller passes `confirm: true`, or the
 * database name for dropDatabase; otherwise the result explains what to pass.
 */

export interface MongoQueryOutcome {
	ok: boolean;
	error?: string;
	command?: string;
	columns: string[];
	rows: EJsonValue[][];
	rowCount: number;
	truncated: boolean;
	durationMs: number;
	note?: string;
}

function tabular(outcome: ShellOutcome): Omit<MongoQueryOutcome, "ok" | "durationMs"> {
	const result = outcome.result;
	const label = outcome.label;
	if (!result) return { columns: [], rows: [], rowCount: 0, truncated: false, command: label };
	switch (result.kind) {
		case "documents": {
			const columns = topLevelColumns(result.docs, 200);
			const rows = result.docs.map((doc) =>
				columns.map((c) => (isObject(doc) && doc[c] !== undefined ? doc[c] : null)),
			);
			return {
				columns,
				rows,
				rowCount: rows.length,
				truncated: result.truncated || result.clipped,
				command: label,
			};
		}
		case "count":
			return {
				columns: ["count"],
				rows: [[result.value]],
				rowCount: 1,
				truncated: false,
				command: label,
			};
		case "text": {
			const rows = result.text.split("\n").map((line) => [line]);
			return { columns: ["result"], rows, rowCount: rows.length, truncated: false, command: label };
		}
		case "value":
			return {
				columns: ["result"],
				rows: [[result.value]],
				rowCount: 1,
				truncated: false,
				command: label,
			};
	}
}

export async function runMongoQuery(
	record: OwnedMongo,
	source: string,
	confirm: boolean | string = false,
): Promise<MongoQueryOutcome> {
	const outcome = await runShell(record, source, confirm);
	const error = outcome.ok
		? undefined
		: outcome.kind === "confirm" && outcome.confirm
			? `${outcome.confirm.message} Pass "confirm": ${
					outcome.confirm.typeToConfirm ? JSON.stringify(outcome.confirm.typeToConfirm) : "true"
				} to run it.`
			: [outcome.error, outcome.friendly].filter(Boolean).join(" ");
	return {
		ok: outcome.ok,
		...tabular(outcome),
		...(error && { error }),
		...(outcome.note && { note: outcome.note }),
		durationMs: outcome.durationMs,
	};
}

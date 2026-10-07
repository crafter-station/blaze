import type { Completion, CompletionContext, CompletionSource } from "@codemirror/autocomplete";
import {
	MariaSQL,
	MySQL,
	PostgreSQL,
	type SQLConfig,
	type SQLDialect,
	SQLite,
	type SQLNamespace,
} from "@codemirror/lang-sql";
import { DIALECTS } from "./dialect";
import type { SchemaSnapshot, SchemaTable, SqlEngine } from "./types";

/**
 * Turns a schema snapshot into CodeMirror's completion config: schemas, tables (with a
 * column count), columns (with their type and PK/nullable flags), plus the dialect's
 * built-in and the database's own functions.
 */

const CM_DIALECTS: Record<SqlEngine, SQLDialect> = {
	postgres: PostgreSQL,
	mysql: MySQL,
	mariadb: MariaSQL,
	libsql: SQLite,
};

export function codemirrorDialect(engine: SqlEngine): SQLDialect {
	return CM_DIALECTS[engine];
}

function columnCompletions(table: SchemaTable): Completion[] {
	return table.columns.map((column) => ({
		label: column.name,
		type: "property",
		detail: column.type.toLowerCase(),
		info: [
			column.isPrimaryKey ? "primary key" : null,
			column.nullable ? "nullable" : "not null",
			column.defaultValue ? `default ${column.defaultValue}` : null,
		]
			.filter(Boolean)
			.join(" · "),
		boost: column.isPrimaryKey ? 2 : 0,
	}));
}

function tableCompletion(table: SchemaTable): Completion {
	return {
		label: table.name,
		type: table.kind === "view" ? "interface" : "type",
		detail: `${table.kind} · ${table.columns.length} col${table.columns.length === 1 ? "" : "s"}`,
	};
}

export function sqlConfig(engine: SqlEngine, snapshot: SchemaSnapshot | null): SQLConfig {
	const dialect = CM_DIALECTS[engine];
	if (!snapshot) return { dialect, upperCaseKeywords: true };

	const namespace: Record<string, SQLNamespace> = {};
	for (const schema of snapshot.schemas) {
		namespace[schema] = {
			self: { label: schema, type: "namespace", detail: "schema" },
			children: {},
		};
	}
	for (const table of snapshot.tables) {
		const entry = namespace[table.schema] as {
			self: Completion;
			children: Record<string, SQLNamespace>;
		};
		if (!entry) continue;
		entry.children[table.name] = {
			self: tableCompletion(table),
			children: columnCompletions(table),
		};
	}

	return {
		dialect,
		schema: namespace,
		defaultSchema: snapshot.defaultSchema,
		upperCaseKeywords: true,
	};
}

/**
 * Function names after a word boundary, never after a `.` (that is a column) and never
 * inside strings or comments.
 */
export function functionCompletionSource(
	engine: SqlEngine,
	snapshot: SchemaSnapshot | null,
): CompletionSource {
	const options: Completion[] = [
		...DIALECTS[engine].functions.map((name) => ({
			label: name,
			type: "function",
			detail: "built-in",
			boost: -1,
		})),
		...(snapshot?.functions ?? []).map((name) => ({
			label: name,
			type: "function",
			detail: "function",
		})),
	];

	return (context: CompletionContext) => {
		const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
		if (!word || (word.from === word.to && !context.explicit)) return null;
		const before = context.state.sliceDoc(Math.max(0, word.from - 1), word.from);
		if (before === "." || before === "'" || before === '"' || before === "`") return null;
		const line = context.state.doc.lineAt(context.pos);
		const prefix = line.text.slice(0, context.pos - line.from);
		// Cheap "inside a comment or string" check for the current line.
		const code = prefix.replace(/'[^']*'/g, "");
		if (code.includes("--") || (DIALECTS[engine].hashComments && code.includes("#"))) return null;
		if ((prefix.match(/'/g)?.length ?? 0) % 2 === 1) return null;
		return { from: word.from, options, validFor: /^[A-Za-z0-9_]*$/ };
	};
}

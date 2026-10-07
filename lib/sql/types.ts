/**
 * Shapes shared by the SQL console's server actions and its client components.
 * Client-safe: no drivers, no `server-only`.
 */

export type SqlEngine = "postgres" | "mysql" | "mariadb" | "libsql";

export function isSqlEngine(engine: string): engine is SqlEngine {
	return engine === "postgres" || engine === "mysql" || engine === "mariadb" || engine === "libsql";
}

/* ------------------------------------------------------------------ *
 * Schema snapshot (explorer, autocomplete, assistant context)
 * ------------------------------------------------------------------ */

export interface SchemaColumn {
	name: string;
	type: string;
	nullable: boolean;
	isPrimaryKey: boolean;
	defaultValue: string | null;
}

export interface SchemaIndex {
	name: string;
	columns: string[];
	unique: boolean;
	primary: boolean;
}

export interface SchemaForeignKey {
	name: string;
	columns: string[];
	refSchema: string;
	refTable: string;
	refColumns: string[];
}

export interface SchemaTable {
	schema: string;
	name: string;
	kind: "table" | "view";
	columns: SchemaColumn[];
	indexes: SchemaIndex[];
	foreignKeys: SchemaForeignKey[];
}

export interface SchemaSnapshot {
	engine: SqlEngine;
	/** The schema unqualified names resolve to: `public`, the MySQL database, or `main`. */
	defaultSchema: string;
	/** Every schema the role can see, including empty ones. */
	schemas: string[];
	tables: SchemaTable[];
	/** User-defined functions and procedures. Built-ins live in `dialect.ts`. */
	functions: string[];
	fetchedAt: number;
}

/* ------------------------------------------------------------------ *
 * Execution
 * ------------------------------------------------------------------ */

export interface ResultColumn {
	name: string;
	/** Engine type name where the driver reports one, e.g. `int4`, `JSON`, `TEXT`. */
	type?: string;
}

export interface StatementOutcome {
	ok: boolean;
	/** Not executed because an earlier statement in the batch failed. */
	skipped?: boolean;
	error?: string;
	/** Postgres: 1-based character offset of the error within the statement. */
	errorPosition?: number;
	columns: ResultColumn[];
	rows: unknown[][];
	/** Rows returned, or rows affected for a write. */
	rowCount: number;
	truncated: boolean;
	command?: string;
	durationMs: number;
}

export interface BatchOutcome {
	ok: boolean;
	/** Set when nothing ran at all, e.g. the database was not found. */
	error?: string;
	results: StatementOutcome[];
}

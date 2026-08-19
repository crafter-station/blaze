import "server-only";
import type { Database, Instance } from "./control/schema";
import { connectTenant, quoteQualified, systemSchemas } from "./tenant-db";

/**
 * Schema browsing, run as the tenant's own role — same model as the SQL editor.
 *
 * Table and schema names arrive from the URL and end up in SQL as identifiers, which
 * cannot be parameterised. Rather than escaping them, every name is checked against the
 * list `information_schema` just returned: a name not in that list is rejected outright.
 * That makes injection structurally impossible instead of dependent on getting a quoting
 * routine right, and it costs one query that was needed for the sidebar anyway.
 *
 * Postgres and MySQL both expose `information_schema` with the same column names, so the
 * queries below are shared. What differs — which schemas are the engine's own, and how an
 * identifier is quoted — lives in `tenant-db.ts`.
 */

export const PAGE_SIZE = 50;

export interface TableRef {
	schema: string;
	name: string;
	type: "table" | "view";
}

export interface ColumnRef {
	name: string;
	type: string;
	nullable: boolean;
	isPrimaryKey: boolean;
}

export interface TablePage {
	columns: ColumnRef[];
	rows: unknown[][];
	total: number;
	offset: number;
	durationMs: number;
}

type Record_ = Database & { instance: Instance };

/** `$1`-style for Postgres, `?` for MySQL. */
function placeholders(record: Record_, count: number): string[] {
	return record.engine === "postgres"
		? Array.from({ length: count }, (_, i) => `$${i + 1}`)
		: Array.from({ length: count }, () => "?");
}

export async function listTables(record: Record_): Promise<TableRef[]> {
	const connection = await connectTenant(record, 20_000);
	try {
		const system = systemSchemas(record.engine);
		const marks = placeholders(record, system.length).join(", ");

		const result = await connection.query(
			`SELECT table_schema, table_name, table_type
			 FROM information_schema.tables
			 WHERE table_schema NOT IN (${marks})
			 ORDER BY table_schema, table_name`,
			system,
		);

		return result.rows.map((row) => ({
			schema: String(row[0]),
			name: String(row[1]),
			type: String(row[2]).toUpperCase().includes("VIEW") ? "view" : "table",
		}));
	} finally {
		await connection.close();
	}
}

export async function readTablePage(
	record: Record_,
	known: TableRef[],
	schema: string,
	table: string,
	offset: number,
): Promise<TablePage | null> {
	// The allow-list: the requested table must have come out of information_schema before
	// its name is ever interpolated into SQL.
	const match = known.find((t) => t.schema === schema && t.name === table);
	if (!match) return null;

	const connection = await connectTenant(record, 20_000);
	const started = Date.now();

	try {
		const [p1, p2] = placeholders(record, 2);

		const columns = await connection.query(
			`SELECT c.column_name, c.data_type, c.is_nullable,
			        CASE WHEN pk.column_name IS NULL THEN 0 ELSE 1 END AS is_pk
			 FROM information_schema.columns c
			 LEFT JOIN (
			   SELECT kcu.column_name
			   FROM information_schema.table_constraints tc
			   JOIN information_schema.key_column_usage kcu
			     ON tc.constraint_name = kcu.constraint_name
			    AND tc.table_schema = kcu.table_schema
			    AND tc.table_name = kcu.table_name
			   WHERE tc.constraint_type = 'PRIMARY KEY'
			     AND tc.table_schema = ${p1} AND tc.table_name = ${p2}
			 ) pk ON c.column_name = pk.column_name
			 WHERE c.table_schema = ${p1} AND c.table_name = ${p2}
			 ORDER BY c.ordinal_position`,
			record.engine === "postgres" ? [schema, table] : [schema, table, schema, table],
		);

		const qualified = quoteQualified(record.engine, match.schema, match.name);

		const count = await connection.query(`SELECT count(*) FROM ${qualified}`);
		const page = await connection.query(
			`SELECT * FROM ${qualified} LIMIT ${PAGE_SIZE} OFFSET ${Math.max(0, Math.floor(offset))}`,
		);

		return {
			columns: columns.rows.map((row) => ({
				name: String(row[0]),
				type: String(row[1]),
				nullable: String(row[2]).toUpperCase() === "YES",
				isPrimaryKey: Number(row[3]) === 1,
			})),
			rows: page.rows,
			total: Number(count.rows[0]?.[0] ?? 0),
			offset,
			durationMs: Date.now() - started,
		};
	} finally {
		await connection.close();
	}
}

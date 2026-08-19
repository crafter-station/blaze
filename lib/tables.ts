import "server-only";
import { Client } from "pg";
import { tenantInternalConnectionString } from "./connection";
import type { Database, Instance } from "./control/schema";

/**
 * Schema browsing, run as the tenant's own role — same model as the SQL editor.
 *
 * Table and schema names arrive from the URL and end up in SQL as identifiers, which
 * cannot be parameterised. Rather than escaping them, every name is checked against the
 * list `information_schema` just returned: a name that is not in that list is rejected
 * outright. That makes injection structurally impossible instead of dependent on getting
 * a quoting routine right, and it costs one query that was needed for the sidebar anyway.
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

function connect(record: Record_): Client {
	return new Client({
		connectionString: tenantInternalConnectionString(
			record.engine,
			record.instance.internalHost,
			record.instance.port,
			record.dbName,
			record.roleName,
			record.passwordEnc,
		),
		connectionTimeoutMillis: 10_000,
		query_timeout: 20_000,
	});
}

export async function listTables(record: Record_): Promise<TableRef[]> {
	const client = connect(record);
	try {
		await client.connect();
		const { rows } = await client.query(
			`SELECT table_schema, table_name, table_type
			 FROM information_schema.tables
			 WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
			 ORDER BY table_schema, table_name`,
		);
		return rows.map((row) => ({
			schema: row.table_schema,
			name: row.table_name,
			type: row.table_type === "VIEW" ? "view" : "table",
		}));
	} finally {
		await client.end().catch(() => {});
	}
}

/**
 * Read one page of a table.
 *
 * `known` is the result of `listTables` and is the allow-list: the requested table must
 * appear in it before its name is ever interpolated into SQL.
 */
export async function readTablePage(
	record: Record_,
	known: TableRef[],
	schema: string,
	table: string,
	offset: number,
): Promise<TablePage | null> {
	const match = known.find((t) => t.schema === schema && t.name === table);
	if (!match) return null;

	const client = connect(record);
	const started = Date.now();

	try {
		await client.connect();

		const columns = await client.query(
			`SELECT c.column_name, c.data_type, c.is_nullable,
			        (pk.column_name IS NOT NULL) AS is_pk
			 FROM information_schema.columns c
			 LEFT JOIN (
			   SELECT kcu.column_name
			   FROM information_schema.table_constraints tc
			   JOIN information_schema.key_column_usage kcu
			     ON tc.constraint_name = kcu.constraint_name
			    AND tc.table_schema = kcu.table_schema
			   WHERE tc.constraint_type = 'PRIMARY KEY'
			     AND tc.table_schema = $1 AND tc.table_name = $2
			 ) pk ON c.column_name = pk.column_name
			 WHERE c.table_schema = $1 AND c.table_name = $2
			 ORDER BY c.ordinal_position`,
			[schema, table],
		);

		// Safe to interpolate: both names came out of information_schema above.
		const qualified = `"${match.schema}"."${match.name}"`;

		const [count, page] = await Promise.all([
			client.query(`SELECT count(*)::int AS total FROM ${qualified}`),
			client.query({
				text: `SELECT * FROM ${qualified} LIMIT $1 OFFSET $2`,
				values: [PAGE_SIZE, offset],
				rowMode: "array",
			}),
		]);

		return {
			columns: columns.rows.map((row) => ({
				name: row.column_name,
				type: row.data_type,
				nullable: row.is_nullable === "YES",
				isPrimaryKey: row.is_pk,
			})),
			rows: page.rows as unknown[][],
			total: count.rows[0].total,
			offset,
			durationMs: Date.now() - started,
		};
	} finally {
		await client.end().catch(() => {});
	}
}

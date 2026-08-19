import pg from "pg";
import type { ColumnInfo, DatabaseConnection, QueryResult, TableInfo } from "./types";

export function createPostgresConnection(connectionUrl: string): DatabaseConnection {
	const pool = new pg.Pool({
		connectionString: connectionUrl,
		max: 3,
		idleTimeoutMillis: 30000,
		ssl: false,
	});

	return {
		async query(sql: string): Promise<QueryResult> {
			const result = await pool.query(sql);
			const columns = result.fields?.map((f) => f.name) ?? [];
			return {
				columns,
				rows: result.rows ?? [],
				rowCount: result.rowCount ?? 0,
			};
		},

		async getSchemas(): Promise<string[]> {
			const result = await pool.query(
				"SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') ORDER BY schema_name",
			);
			return result.rows.map((r) => r.schema_name);
		},

		async getTables(schema = "public"): Promise<TableInfo[]> {
			const result = await pool.query(
				"SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
				[schema],
			);
			return result.rows.map((r) => ({
				name: r.table_name,
				schema,
				type: r.table_type === "VIEW" ? "view" : "table",
			}));
		},

		async getColumns(table: string, schema = "public"): Promise<ColumnInfo[]> {
			const result = await pool.query(
				`SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
				 CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_pk
				 FROM information_schema.columns c
				 LEFT JOIN (
				   SELECT kcu.column_name
				   FROM information_schema.table_constraints tc
				   JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
				   WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2
				 ) pk ON c.column_name = pk.column_name
				 WHERE c.table_schema = $1 AND c.table_name = $2
				 ORDER BY c.ordinal_position`,
				[schema, table],
			);
			return result.rows.map((r) => ({
				name: r.column_name,
				type: r.data_type,
				nullable: r.is_nullable === "YES",
				defaultValue: r.column_default,
				isPrimaryKey: r.is_pk,
			}));
		},

		async getTableData(
			table: string,
			schema = "public",
			limit = 50,
			offset = 0,
		): Promise<QueryResult> {
			const identifier = `"${schema}"."${table}"`;
			const result = await pool.query(`SELECT * FROM ${identifier} LIMIT $1 OFFSET $2`, [
				limit,
				offset,
			]);
			const columns = result.fields?.map((f) => f.name) ?? [];
			return {
				columns,
				rows: result.rows ?? [],
				rowCount: result.rowCount ?? 0,
			};
		},

		async close(): Promise<void> {
			await pool.end();
		},
	};
}

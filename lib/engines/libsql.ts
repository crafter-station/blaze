import { createClient } from "@libsql/client";
import type { ColumnInfo, DatabaseConnection, QueryResult, TableInfo } from "./types";

export function createLibsqlConnection(connectionUrl: string): DatabaseConnection {
	const client = createClient({ url: connectionUrl });

	return {
		async query(sql: string): Promise<QueryResult> {
			const result = await client.execute(sql);
			const columns = result.columns;
			const rows = result.rows.map((row) => {
				const obj: Record<string, unknown> = {};
				for (let i = 0; i < columns.length; i++) {
					obj[columns[i]] = row[i];
				}
				return obj;
			});
			return {
				columns,
				rows,
				rowCount: result.rowsAffected,
			};
		},

		async getSchemas(): Promise<string[]> {
			return ["main"];
		},

		async getTables(): Promise<TableInfo[]> {
			const result = await client.execute(
				"SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
			);
			return result.rows.map((r) => ({
				name: r[0] as string,
				schema: "main",
				type: (r[1] as string) === "view" ? "view" : "table",
			}));
		},

		async getColumns(table: string): Promise<ColumnInfo[]> {
			const result = await client.execute(`PRAGMA table_info("${table}")`);
			return result.rows.map((r) => ({
				name: r[1] as string,
				type: r[2] as string,
				nullable: (r[3] as number) === 0,
				defaultValue: r[4] as string | undefined,
				isPrimaryKey: (r[5] as number) === 1,
			}));
		},

		async getTableData(
			table: string,
			_schema?: string,
			limit = 50,
			offset = 0,
		): Promise<QueryResult> {
			const result = await client.execute({
				sql: `SELECT * FROM "${table}" LIMIT ? OFFSET ?`,
				args: [limit, offset],
			});
			const columns = result.columns;
			const rows = result.rows.map((row) => {
				const obj: Record<string, unknown> = {};
				for (let i = 0; i < columns.length; i++) {
					obj[columns[i]] = row[i];
				}
				return obj;
			});
			return {
				columns,
				rows,
				rowCount: rows.length,
			};
		},

		async close(): Promise<void> {
			client.close();
		},
	};
}

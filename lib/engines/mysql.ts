import mysql from "mysql2/promise";
import type { ColumnInfo, DatabaseConnection, QueryResult, TableInfo } from "./types";

export function createMysqlConnection(connectionUrl: string): DatabaseConnection {
	const pool = mysql.createPool({
		uri: connectionUrl,
		connectionLimit: 3,
		idleTimeout: 30000,
	});

	return {
		async query(sql: string): Promise<QueryResult> {
			const [rows, fields] = await pool.query(sql);
			const resultRows = Array.isArray(rows) ? rows : [];
			const columns = fields && Array.isArray(fields) ? fields.map((f) => f.name) : [];
			return {
				columns,
				rows: resultRows as Record<string, unknown>[],
				rowCount: resultRows.length,
			};
		},

		async getSchemas(): Promise<string[]> {
			const [rows] = await pool.query("SHOW DATABASES");
			return (rows as { Database: string }[]).map((r) => r.Database);
		},

		async getTables(schema?: string): Promise<TableInfo[]> {
			const db =
				schema ?? new URL(connectionUrl.replace("mariadb://", "mysql://")).pathname.slice(1);
			const [rows] = await pool.query(
				"SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
				[db],
			);
			return (rows as { TABLE_NAME: string; TABLE_TYPE: string }[]).map((r) => ({
				name: r.TABLE_NAME,
				schema: db,
				type: r.TABLE_TYPE === "VIEW" ? "view" : "table",
			}));
		},

		async getColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
			const db =
				schema ?? new URL(connectionUrl.replace("mariadb://", "mysql://")).pathname.slice(1);
			const [rows] = await pool.query(
				"SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
				[db, table],
			);
			return (rows as Record<string, string>[]).map((r) => ({
				name: r.COLUMN_NAME,
				type: r.DATA_TYPE,
				nullable: r.IS_NULLABLE === "YES",
				defaultValue: r.COLUMN_DEFAULT,
				isPrimaryKey: r.COLUMN_KEY === "PRI",
			}));
		},

		async getTableData(
			table: string,
			_schema?: string,
			limit = 50,
			offset = 0,
		): Promise<QueryResult> {
			const identifier = `\`${table}\``;
			const [rows, fields] = await pool.query(`SELECT * FROM ${identifier} LIMIT ? OFFSET ?`, [
				limit,
				offset,
			]);
			const resultRows = Array.isArray(rows) ? rows : [];
			const columns = fields && Array.isArray(fields) ? fields.map((f) => f.name) : [];
			return {
				columns,
				rows: resultRows as Record<string, unknown>[],
				rowCount: resultRows.length,
			};
		},

		async close(): Promise<void> {
			await pool.end();
		},
	};
}

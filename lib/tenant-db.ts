import "server-only";
import mysql from "mysql2/promise";
import { Client } from "pg";
import { tenantInternalConnectionString } from "./connection";
import type { Database, Instance } from "./control/schema";

/**
 * One query interface over every engine, connecting **as the tenant's own role**.
 *
 * That last part is the whole security model of the SQL editor, the table browser and the
 * `/v1` query endpoint: whatever the engine grants that role is exactly what these can
 * reach. Nothing above this layer needs its own permission checks, and nothing above it
 * can accidentally acquire admin rights.
 *
 * Rows come back as arrays rather than objects so a result with two columns of the same
 * name — perfectly legal in a join — does not silently lose one.
 */

export interface TenantResult {
	columns: string[];
	rows: unknown[][];
	rowCount: number;
	/** e.g. "CREATE TABLE". The only feedback a non-SELECT statement gives. */
	command?: string;
}

export interface TenantConnection {
	query(sql: string, params?: unknown[]): Promise<TenantResult>;
	close(): Promise<void>;
}

type Record_ = Database & { instance: Instance };

function url(record: Record_): string {
	return tenantInternalConnectionString(
		record.engine,
		record.instance.internalHost,
		record.instance.port,
		record.dbName,
		record.roleName,
		record.passwordEnc,
	);
}

async function connectPostgres(record: Record_, timeoutMs: number): Promise<TenantConnection> {
	const client = new Client({
		connectionString: url(record),
		connectionTimeoutMillis: 10_000,
		query_timeout: timeoutMs,
	});
	await client.connect();

	return {
		async query(sql, params) {
			const result = await client.query({ text: sql, values: params, rowMode: "array" });
			// node-postgres returns an array for multi-statement queries; the last one is what
			// a caller means by "the result", matching how psql reports a batch.
			const last = (Array.isArray(result) ? result[result.length - 1] : result) as {
				rows?: unknown[][];
				fields?: { name: string }[];
				rowCount?: number | null;
				command?: string;
			};
			const rows = last.rows ?? [];
			return {
				columns: last.fields?.map((f) => f.name) ?? [],
				rows,
				rowCount: last.rowCount ?? rows.length,
				command: last.command,
			};
		},
		async close() {
			await client.end().catch(() => {});
		},
	};
}

async function connectMysql(record: Record_, timeoutMs: number): Promise<TenantConnection> {
	const parsed = new URL(url(record));
	const conn = await mysql.createConnection({
		host: parsed.hostname,
		port: Number(parsed.port || 3306),
		user: decodeURIComponent(parsed.username),
		password: decodeURIComponent(parsed.password),
		database: record.dbName,
		connectTimeout: 10_000,
		// The instance refuses unencrypted connections; the certificate is self-signed.
		ssl: { rejectUnauthorized: false },
		rowsAsArray: true,
		// Editors get multi-statement batches; the tenant's grants still bound what runs.
		multipleStatements: true,
	});

	return {
		async query(sql, params) {
			const [rows, fields] = (await Promise.race([
				conn.query({ sql, values: params }),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Query timed out")), timeoutMs),
				),
			])) as [unknown, mysql.FieldPacket[] | undefined];

			/*
			 * mysql2's result shape depends on the statement, and getting this wrong is silent:
			 *
			 *   single write   rows = OkPacket,          fields = undefined
			 *   single select  rows = [[...]],           fields = [FieldPacket, ...]
			 *   batch          rows = [Ok, Ok, [[...]]], fields = [undefined, undefined, [FieldPacket]]
			 *
			 * The batch case is the trap: `fields[0]` is `undefined` for a leading non-SELECT,
			 * so testing `Array.isArray(fields[0])` classifies a batch as a single select and
			 * then maps over undefined entries. Detect on the *rows* side instead, where every
			 * batch element is either an array or an OkPacket.
			 */
			const isBatch =
				Array.isArray(rows) &&
				rows.length > 0 &&
				rows.every(
					(entry) =>
						Array.isArray(entry) ||
						(entry !== null && typeof entry === "object" && "affectedRows" in (entry as object)),
				);

			const finalRows = isBatch ? (rows as unknown[])[(rows as unknown[]).length - 1] : rows;
			const finalFields = isBatch
				? (fields as unknown as (mysql.FieldPacket[] | undefined)[])?.[
						(fields as unknown[]).length - 1
					]
				: fields;

			// A write returns an OkPacket rather than rows — MySQL's way of saying "no result
			// set" — surfaced as an empty result rather than as a shape error.
			if (!Array.isArray(finalRows)) {
				return {
					columns: [],
					rows: [],
					rowCount: (finalRows as { affectedRows?: number })?.affectedRows ?? 0,
					command: "OK",
				};
			}

			return {
				// Filter before mapping: a batch's field array can still carry undefined slots.
				columns: (finalFields ?? []).filter(Boolean).map((f) => f.name),
				rows: finalRows as unknown[][],
				rowCount: (finalRows as unknown[][]).length,
				command: "SELECT",
			};
		},
		async close() {
			await conn.end().catch(() => {});
		},
	};
}

export async function connectTenant(
	record: Record_,
	timeoutMs = 35_000,
): Promise<TenantConnection> {
	switch (record.engine) {
		case "postgres":
			return connectPostgres(record, timeoutMs);
		case "mysql":
		case "mariadb":
			return connectMysql(record, timeoutMs);
		default:
			throw new Error(`Queries are not supported for ${record.engine} yet`);
	}
}

/** Identifier quoting differs per engine and cannot be parameterised. */
export function quoteQualified(engine: Database["engine"], schema: string, table: string): string {
	return engine === "postgres" ? `"${schema}"."${table}"` : `\`${schema}\`.\`${table}\``;
}

/** Schemas that belong to the engine, not the tenant. */
export function systemSchemas(engine: Database["engine"]): string[] {
	return engine === "postgres"
		? ["pg_catalog", "information_schema", "pg_toast"]
		: ["information_schema", "mysql", "performance_schema", "sys"];
}

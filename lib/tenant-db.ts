import "server-only";
import { createClient } from "@libsql/client";
import mysql from "mysql2/promise";
import { Client, types as pgTypes } from "pg";
import { tenantInternalConnectionString } from "./connection";
import type { Database, Instance } from "./control/schema";
import { decryptSecret } from "./crypto";
import { resolveTenantTarget } from "./dev-override";

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
	/** Engine type name per column where the driver reports one, e.g. `int4`, `JSON`. */
	columnTypes?: string[];
}

export interface TenantConnection {
	query(sql: string, params?: unknown[]): Promise<TenantResult>;
	close(): Promise<void>;
}

type Record_ = Database & { instance: Instance };

export interface ConnectOptions {
	/**
	 * Return dates, times, intervals and big numbers as the engine's own text rather than
	 * JS `Date`s and doubles. The SQL console wants exactly what the database said; a
	 * `Date` would be re-rendered in the server's time zone and lose precision.
	 */
	textValues?: boolean;
}

/** Postgres date/time OIDs whose text form is kept verbatim with `textValues`. */
const PG_TEXT_OIDS = new Set([1082, 1083, 1114, 1184, 1186, 1266]);

/** Where the tenant's engine is reached. Only a dev build can redirect it — see dev-override. */
function target(record: Record_) {
	return resolveTenantTarget(record.engine, {
		host: record.instance.internalHost,
		port: record.instance.port,
	});
}

function url(record: Record_): string {
	const { host, port } = target(record);
	return tenantInternalConnectionString(
		record.engine,
		host,
		port,
		record.dbName,
		record.roleName,
		record.passwordEnc,
	);
}

/** node-postgres reports column types as OIDs; these are the ones worth naming. */
const PG_TYPES: Record<number, string> = {
	16: "bool",
	17: "bytea",
	18: "char",
	19: "name",
	20: "int8",
	21: "int2",
	23: "int4",
	25: "text",
	26: "oid",
	114: "json",
	142: "xml",
	199: "json[]",
	650: "cidr",
	700: "float4",
	701: "float8",
	790: "money",
	829: "macaddr",
	869: "inet",
	1000: "bool[]",
	1005: "int2[]",
	1007: "int4[]",
	1009: "text[]",
	1015: "varchar[]",
	1016: "int8[]",
	1021: "float4[]",
	1022: "float8[]",
	1042: "bpchar",
	1043: "varchar",
	1082: "date",
	1083: "time",
	1114: "timestamp",
	1184: "timestamptz",
	1186: "interval",
	1231: "numeric[]",
	1266: "timetz",
	1560: "bit",
	1562: "varbit",
	1700: "numeric",
	2249: "record",
	2278: "void",
	2950: "uuid",
	2951: "uuid[]",
	3614: "tsvector",
	3802: "jsonb",
	3807: "jsonb[]",
};

/** mysql2 column type codes (`FieldPacket.columnType`). */
const MYSQL_TYPES: Record<number, string> = {
	0: "DECIMAL",
	1: "TINYINT",
	2: "SMALLINT",
	3: "INT",
	4: "FLOAT",
	5: "DOUBLE",
	6: "NULL",
	7: "TIMESTAMP",
	8: "BIGINT",
	9: "MEDIUMINT",
	10: "DATE",
	11: "TIME",
	12: "DATETIME",
	13: "YEAR",
	15: "VARCHAR",
	16: "BIT",
	245: "JSON",
	246: "DECIMAL",
	247: "ENUM",
	248: "SET",
	249: "TINYBLOB",
	250: "MEDIUMBLOB",
	251: "LONGBLOB",
	252: "BLOB",
	253: "VARCHAR",
	254: "CHAR",
	255: "GEOMETRY",
};

function mysqlTypeName(field: mysql.FieldPacket): string {
	const code = (field as unknown as { columnType?: number }).columnType ?? field.type ?? -1;
	const name = MYSQL_TYPES[code] ?? "UNKNOWN";
	// Charset 63 is `binary`: a BLOB with any other charset is a TEXT column.
	if (name.endsWith("BLOB") && field.characterSet !== 63) return name.replace("BLOB", "TEXT");
	return name;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("Query timed out")), timeoutMs);
		}),
	]).finally(() => clearTimeout(timer));
}

async function connectPostgres(
	record: Record_,
	timeoutMs: number,
	options: ConnectOptions,
): Promise<TenantConnection> {
	const client = new Client({
		connectionString: url(record),
		connectionTimeoutMillis: 10_000,
		...(options.textValues && {
			types: {
				getTypeParser: ((oid: number, format?: "text" | "binary") =>
					PG_TEXT_OIDS.has(oid)
						? (value: string) => value
						: pgTypes.getTypeParser(oid, format)) as typeof pgTypes.getTypeParser,
			},
		}),
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
				fields?: { name: string; dataTypeID: number }[];
				rowCount?: number | null;
				command?: string;
			};
			const rows = last.rows ?? [];
			return {
				columns: last.fields?.map((f) => f.name) ?? [],
				columnTypes: last.fields?.map((f) => PG_TYPES[f.dataTypeID] ?? `oid ${f.dataTypeID}`),
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

async function connectMysql(
	record: Record_,
	timeoutMs: number,
	options: ConnectOptions,
): Promise<TenantConnection> {
	const parsed = new URL(url(record));
	const conn = await mysql.createConnection({
		...(options.textValues && {
			dateStrings: true,
			supportBigNumbers: true,
			bigNumberStrings: true,
		}),
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
			const [rows, fields] = (await withTimeout(
				conn.query({ sql, values: params }),
				timeoutMs,
			)) as [unknown, mysql.FieldPacket[] | undefined];

			/*
			 * mysql2's result shape depends on the statement, and getting this wrong is silent:
			 *
			 *   single write   rows = OkPacket,              fields = undefined
			 *   single select  rows = [[v, v], [v, v]],      fields = [FieldPacket, ...]
			 *   batch          rows = [Ok, Ok, [[v, v]]],    fields = [undefined, undefined, [FieldPacket]]
			 *
			 * With `rowsAsArray`, every row of a single SELECT is itself an array, so the rows
			 * side cannot tell a one-statement result from a batch. The fields side can: a
			 * single SELECT has FieldPacket objects there, a batch has one slot per statement
			 * holding either a FieldPacket array or `undefined`.
			 */
			const isOk = (entry: unknown) =>
				entry !== null &&
				typeof entry === "object" &&
				!Array.isArray(entry) &&
				"affectedRows" in entry;
			const isBatch = Array.isArray(fields)
				? fields.length > 0 &&
					fields.every((slot) => slot === undefined || slot === null || Array.isArray(slot)) &&
					Array.isArray(rows) &&
					rows.length === fields.length
				: Array.isArray(rows) && rows.length > 0 && rows.every(isOk);

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

			// Filter before mapping: a batch's field array can still carry undefined slots.
			const present = (finalFields ?? []).filter(Boolean);
			return {
				columns: present.map((f) => f.name),
				columnTypes: present.map(mysqlTypeName),
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

/**
 * libSQL speaks HTTP (Hrana) rather than a socket protocol, so a "connection" is a client
 * object. The tenant's token is its password, exactly as in the connection string the
 * dashboard hands out.
 */
async function connectLibsql(record: Record_, timeoutMs: number): Promise<TenantConnection> {
	const { host, port } = target(record);
	const client = createClient({
		url: `http://${host}:${port}`,
		authToken: decryptSecret(record.passwordEnc),
	});

	return {
		async query(sql, params) {
			const result = await withTimeout(
				client.execute({ sql, args: (params ?? []) as never[] }),
				timeoutMs,
			);
			const columns = result.columns;
			const rows = result.rows.map((row) => columns.map((_, index) => row[index]));
			const returnsRows = columns.length > 0;
			return {
				columns,
				columnTypes: result.columnTypes.map((type) => type || "ANY"),
				rows,
				rowCount: returnsRows ? rows.length : result.rowsAffected,
				command: returnsRows ? "SELECT" : "OK",
			};
		},
		async close() {
			client.close();
		},
	};
}

export async function connectTenant(
	record: Record_,
	timeoutMs = 35_000,
	options: ConnectOptions = {},
): Promise<TenantConnection> {
	switch (record.engine) {
		case "postgres":
			return connectPostgres(record, timeoutMs, options);
		case "mysql":
		case "mariadb":
			return connectMysql(record, timeoutMs, options);
		case "libsql":
			return connectLibsql(record, timeoutMs);
		default:
			throw new Error(`Queries are not supported for ${record.engine} yet`);
	}
}

/** Identifier quoting differs per engine and cannot be parameterised. */
export function quoteQualified(engine: Database["engine"], schema: string, table: string): string {
	return engine === "postgres" || engine === "libsql"
		? `"${schema}"."${table}"`
		: `\`${schema}\`.\`${table}\``;
}

/** Schemas that belong to the engine, not the tenant. */
export function systemSchemas(engine: Database["engine"]): string[] {
	return engine === "postgres"
		? ["pg_catalog", "information_schema", "pg_toast"]
		: ["information_schema", "mysql", "performance_schema", "sys"];
}

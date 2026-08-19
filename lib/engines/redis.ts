import Redis from "ioredis";
import type { ColumnInfo, DatabaseConnection, QueryResult, TableInfo } from "./types";

export function createRedisConnection(connectionUrl: string): DatabaseConnection {
	const client = new Redis(connectionUrl, { lazyConnect: true });

	return {
		async query(command: string): Promise<QueryResult> {
			await client.connect();
			const parts = command.trim().split(/\s+/);
			const cmd = parts[0]?.toUpperCase() ?? "";
			const args = parts.slice(1);

			const result = await client.call(cmd, ...args);
			const rows = formatRedisResult(result);

			return {
				columns: ["key", "value"],
				rows,
				rowCount: rows.length,
			};
		},

		async getSchemas(): Promise<string[]> {
			return ["0"];
		},

		async getTables(_schema?: string): Promise<TableInfo[]> {
			await client.connect();
			const keys: string[] = [];
			let cursor = "0";

			// Scan up to 200 keys
			do {
				const [nextCursor, batch] = await client.scan(cursor, "COUNT", 100);
				cursor = nextCursor;
				keys.push(...batch);
			} while (cursor !== "0" && keys.length < 200);

			return keys.sort().map((key) => ({
				name: key,
				type: "table" as const,
			}));
		},

		async getColumns(key: string): Promise<ColumnInfo[]> {
			await client.connect();
			const type = await client.type(key);
			return [
				{ name: "key", type: "string", nullable: false },
				{ name: "value", type, nullable: true },
			];
		},

		async getTableData(key: string): Promise<QueryResult> {
			await client.connect();
			const type = await client.type(key);

			let rows: Record<string, unknown>[] = [];

			switch (type) {
				case "string": {
					const val = await client.get(key);
					rows = [{ key, value: val }];
					break;
				}
				case "list": {
					const vals = await client.lrange(key, 0, 49);
					rows = vals.map((v, i) => ({ key: `[${i}]`, value: v }));
					break;
				}
				case "set": {
					const vals = await client.smembers(key);
					rows = vals.map((v) => ({ key: v, value: v }));
					break;
				}
				case "zset": {
					const vals = await client.zrange(key, 0, 49, "WITHSCORES");
					for (let i = 0; i < vals.length; i += 2) {
						rows.push({ key: vals[i], value: vals[i + 1] });
					}
					break;
				}
				case "hash": {
					const vals = await client.hgetall(key);
					rows = Object.entries(vals).map(([k, v]) => ({ key: k, value: v }));
					break;
				}
				default:
					rows = [{ key, value: `(type: ${type})` }];
			}

			return {
				columns: ["key", "value"],
				rows,
				rowCount: rows.length,
			};
		},

		async close(): Promise<void> {
			client.disconnect();
		},
	};
}

function formatRedisResult(result: unknown): Record<string, unknown>[] {
	if (result === null || result === undefined) {
		return [{ key: "(nil)", value: null }];
	}
	if (Array.isArray(result)) {
		return result.map((v, i) => ({ key: String(i), value: String(v) }));
	}
	return [{ key: "result", value: String(result) }];
}

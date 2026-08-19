import { MongoClient } from "mongodb";
import type { ColumnInfo, DatabaseConnection, QueryResult, TableInfo } from "./types";

export function createMongoConnection(connectionUrl: string): DatabaseConnection {
	const client = new MongoClient(connectionUrl);
	let dbName = "admin";

	return {
		async query(command: string): Promise<QueryResult> {
			await client.connect();
			const db = client.db(dbName);

			// Try to parse as JSON find command: { collection: "name", filter: {} }
			try {
				const parsed = JSON.parse(command);
				if (parsed.collection) {
					const filter = parsed.filter ?? {};
					const limit = parsed.limit ?? 50;
					const docs = await db.collection(parsed.collection).find(filter).limit(limit).toArray();
					const columns = docs.length > 0 ? Object.keys(docs[0]) : [];
					return {
						columns,
						rows: docs as Record<string, unknown>[],
						rowCount: docs.length,
					};
				}
			} catch {
				// Not JSON, try as collection name
			}

			// If plain string, treat as collection name and return docs
			const docs = await db.collection(command).find().limit(50).toArray();
			const columns = docs.length > 0 ? Object.keys(docs[0]) : [];
			return {
				columns,
				rows: docs as Record<string, unknown>[],
				rowCount: docs.length,
			};
		},

		async getSchemas(): Promise<string[]> {
			await client.connect();
			const adminDb = client.db().admin();
			const result = await adminDb.listDatabases();
			return result.databases.map((d) => d.name);
		},

		async getTables(schema?: string): Promise<TableInfo[]> {
			await client.connect();
			if (schema) dbName = schema;
			const db = client.db(dbName);
			const collections = await db.listCollections().toArray();
			return collections.map((c) => ({
				name: c.name,
				schema: dbName,
				type: "collection" as const,
			}));
		},

		async getColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
			await client.connect();
			const db = client.db(schema ?? dbName);
			const doc = await db.collection(table).findOne();
			if (!doc) return [];
			return Object.entries(doc).map(([key, value]) => ({
				name: key,
				type: typeof value,
				nullable: true,
			}));
		},

		async getTableData(
			table: string,
			schema?: string,
			limit = 50,
			offset = 0,
		): Promise<QueryResult> {
			await client.connect();
			const db = client.db(schema ?? dbName);
			const docs = await db.collection(table).find().skip(offset).limit(limit).toArray();
			const columns = docs.length > 0 ? Object.keys(docs[0]) : [];
			return {
				columns,
				rows: docs as Record<string, unknown>[],
				rowCount: docs.length,
			};
		},

		async close(): Promise<void> {
			await client.close();
		},
	};
}

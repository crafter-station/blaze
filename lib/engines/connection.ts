import { createLibsqlConnection } from "./libsql";
import { createMongoConnection } from "./mongo";
import { createMysqlConnection } from "./mysql";
import { createPostgresConnection } from "./postgres";
import type { DatabaseConnection, Engine } from "./types";

export function createConnection(type: Engine, connectionUrl: string): DatabaseConnection {
	switch (type) {
		case "postgres":
			return createPostgresConnection(connectionUrl);
		case "mysql":
		case "mariadb":
			return createMysqlConnection(connectionUrl);
		case "mongo":
			return createMongoConnection(connectionUrl);
		// Redis is not a table-shaped engine: its console and key browser speak RESP3
		// directly as the tenant (lib/redis/tenant.ts) rather than through this interface.
		case "libsql":
			return createLibsqlConnection(connectionUrl);
		default:
			throw new Error(`Unsupported engine: ${type}`);
	}
}

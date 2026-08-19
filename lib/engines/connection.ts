import { createLibsqlConnection } from "./libsql";
import { createMongoConnection } from "./mongo";
import { createMysqlConnection } from "./mysql";
import { createPostgresConnection } from "./postgres";
import { createRedisConnection } from "./redis";
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
		case "redis":
			return createRedisConnection(connectionUrl);
		case "libsql":
			return createLibsqlConnection(connectionUrl);
		default:
			throw new Error(`Unsupported engine: ${type}`);
	}
}

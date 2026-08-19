import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Connection to blaze's own control-plane database.
 *
 * Built on first use rather than at module load, for the same reason `lib/env` validates
 * lazily: `next build` imports every route module, and opening a pool against a
 * `DATABASE_URL` that only exists at runtime would fail the build.
 *
 * Cached on `globalThis` so Next's dev-mode module reloading doesn't leak a new pool on
 * every edit until the server runs out of connections.
 */
const globalForDb = globalThis as unknown as { blazePool?: Pool; blazeDb?: Db };

function connect(): Db {
	if (globalForDb.blazeDb) return globalForDb.blazeDb;

	const pool =
		globalForDb.blazePool ??
		new Pool({
			connectionString: env.DATABASE_URL,
			max: 10,
			idleTimeoutMillis: 30_000,
		});

	const instance = drizzle(pool, { schema });

	if (env.NODE_ENV !== "production") {
		globalForDb.blazePool = pool;
		globalForDb.blazeDb = instance;
	}

	return instance;
}

let cached: Db | null = null;

export const db = new Proxy({} as Db, {
	get(_target, prop) {
		if (!cached) cached = connect();
		return cached[prop as keyof Db];
	},
});

export { schema };

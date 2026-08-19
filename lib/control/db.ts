import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Connection to blaze's own control-plane database.
 *
 * Cached on `globalThis` so Next's dev-mode module reloading doesn't leak a new pool on
 * every edit until the server runs out of connections.
 */
const globalForDb = globalThis as unknown as { blazePool?: Pool };

const pool =
	globalForDb.blazePool ??
	new Pool({
		connectionString: env.DATABASE_URL,
		max: 10,
		idleTimeoutMillis: 30_000,
	});

if (env.NODE_ENV !== "production") globalForDb.blazePool = pool;

export const db = drizzle(pool, { schema });
export { schema };

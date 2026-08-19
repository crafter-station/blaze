import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/control/db";
import { type Instance, instances } from "@/lib/control/schema";
import { ENGINE_CONFIG, type Engine } from "@/lib/engines/types";

export class NoCapacityError extends Error {
	constructor(engine: Engine) {
		super(`No instance with spare capacity for ${engine}`);
		this.name = "NoCapacityError";
	}
}

/**
 * Choose which instance a new database lands on.
 *
 * One row today, so this always returns the same instance — the point is that adding a
 * second node later is an INSERT rather than a migration and a rewrite of every call site
 * (PLAN.md Q16). Least-loaded wins, and `draining` instances are skipped so a node can be
 * retired by stopping new placements without moving existing tenants.
 */
export async function selectInstance(engine: Engine): Promise<Instance> {
	const candidates = await db
		.select()
		.from(instances)
		.where(
			and(
				eq(instances.engine, engine),
				eq(instances.tenancy, ENGINE_CONFIG[engine].tenancy),
				eq(instances.status, "active"),
				sql`${instances.databaseCount} < ${instances.capacity}`,
			),
		)
		.orderBy(asc(instances.databaseCount))
		.limit(1);

	const instance = candidates[0];
	if (!instance) throw new NoCapacityError(engine);
	return instance;
}

/**
 * Keeps `databaseCount` in step with reality. Incremented as part of the same transaction
 * that inserts the database row, so a failed provision cannot inflate the count and
 * slowly starve an instance of capacity it actually has.
 */
export async function bumpDatabaseCount(instanceId: string, delta: number): Promise<void> {
	await db
		.update(instances)
		.set({ databaseCount: sql`GREATEST(0, ${instances.databaseCount} + ${delta})` })
		.where(eq(instances.id, instanceId));
}

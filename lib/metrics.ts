import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { adminConnectionString } from "./connection";
import { db } from "./control/db";
import { auditLog, databaseMetrics, databases } from "./control/schema";
import { newId } from "./id";
import { LIMITS, METRICS_INTERVAL_MS } from "./limits";
import { isSupported, opsFor } from "./provision/engines";

/**
 * Per-database metrics sampling.
 *
 * Dokploy's container metrics describe a whole shared instance, so they say nothing about
 * an individual tenant. Numbers here come from engine-native stats instead.
 *
 * This is not only a chart feed. Postgres has no per-database disk quota, so this sampler
 * is the *only* thing enforcing the storage limit — which is why it suspends rather than
 * merely recording. A tenant that quietly grows past its cap between samples is the
 * expected case, not a bug; the sample is what closes it.
 */

export interface SampleOutcome {
	databaseId: string;
	name: string;
	sizeBytes: number;
	connections: number;
	suspended: boolean;
	error?: string;
}

/** Sample one database, persist the point, and enforce the storage quota. */
export async function sampleDatabase(databaseId: string): Promise<SampleOutcome> {
	const record = await db.query.databases.findFirst({
		where: and(eq(databases.id, databaseId), isNull(databases.deletedAt)),
		with: { instance: true },
	});
	if (!record) throw new Error("Database not found");

	const base: SampleOutcome = {
		databaseId: record.id,
		name: record.name,
		sizeBytes: record.sizeBytes,
		connections: 0,
		suspended: record.status === "suspended",
	};

	// Engines without a provisioner have no stats to read either.
	if (!isSupported(record.engine)) return base;
	const ops = opsFor(record.engine);

	const adminUrl = adminConnectionString(
		record.engine,
		record.instance.internalHost,
		record.instance.port,
		record.instance.adminUser,
		record.instance.adminPasswordEnc,
	);

	let stats: Awaited<ReturnType<typeof ops.readStats>>;
	try {
		stats = await ops.readStats(adminUrl, record.dbName);
	} catch (error) {
		// One unreachable database must not abort a sweep over all of them.
		return { ...base, error: error instanceof Error ? error.message : "unreachable" };
	}

	await db.insert(databaseMetrics).values({
		databaseId: record.id,
		sizeBytes: stats.sizeBytes,
		connections: stats.connections,
		xactCommit: stats.xactCommit,
	});

	await db.update(databases).set({ sizeBytes: stats.sizeBytes }).where(eq(databases.id, record.id));

	let suspended = record.status === "suspended";

	if (stats.sizeBytes > LIMITS.STORAGE_BYTES && record.status === "active") {
		// Data is kept — connections are refused, nothing is dropped. Over quota is a
		// recoverable state the user can fix, not grounds for destroying their database.
		await ops.suspend(adminUrl, record.dbName, record.roleName);
		await db.update(databases).set({ status: "suspended" }).where(eq(databases.id, record.id));

		await db.insert(auditLog).values({
			id: newId("db"),
			actorUserId: null,
			action: "database.suspend",
			targetType: "database",
			targetId: record.id,
			metadata: { reason: "storage_quota", sizeBytes: stats.sizeBytes },
		});
		suspended = true;
	} else if (stats.sizeBytes <= LIMITS.STORAGE_BYTES && record.status === "suspended") {
		// Suspension has to be self-clearing. A tenant who frees space and stays locked out
		// would need a human to notice, which for a free service means never.
		await ops.resume(adminUrl, record.dbName, record.roleName);
		await db.update(databases).set({ status: "active" }).where(eq(databases.id, record.id));

		await db.insert(auditLog).values({
			id: newId("db"),
			actorUserId: null,
			action: "database.resume",
			targetType: "database",
			targetId: record.id,
			metadata: { reason: "under_quota", sizeBytes: stats.sizeBytes },
		});
		suspended = false;
	}

	return {
		databaseId: record.id,
		name: record.name,
		sizeBytes: stats.sizeBytes,
		connections: stats.connections,
		suspended,
	};
}

/** Sample every live database. Errors are collected, never thrown — one bad tenant
 *  must not stop the sweep that enforces everyone else's quota. */
export async function sampleAllDatabases(): Promise<SampleOutcome[]> {
	const live = await db
		.select({ id: databases.id })
		.from(databases)
		.where(isNull(databases.deletedAt));

	const results: SampleOutcome[] = [];
	for (const { id } of live) {
		try {
			results.push(await sampleDatabase(id));
		} catch (error) {
			results.push({
				databaseId: id,
				name: id,
				sizeBytes: 0,
				connections: 0,
				suspended: false,
				error: error instanceof Error ? error.message : "failed",
			});
		}
	}
	return results;
}

export interface MetricPoint {
	ts: string;
	sizeBytes: number;
	connections: number;
	/** Commits since the previous sample. Null for the first point, which has no delta. */
	commits: number | null;
}

/**
 * History for one database.
 *
 * `xact_commit` is a cumulative counter that resets when the server restarts, so it is
 * returned as a delta between consecutive samples. A negative delta means a restart
 * happened, and is reported as null rather than a nonsensical spike downward.
 */
export async function readHistory(databaseId: string, hours = 24): Promise<MetricPoint[]> {
	const since = new Date(Date.now() - hours * 3_600_000);

	const rows = await db
		.select()
		.from(databaseMetrics)
		.where(and(eq(databaseMetrics.databaseId, databaseId), gte(databaseMetrics.ts, since)))
		.orderBy(desc(databaseMetrics.ts))
		.limit(500);

	const ordered = rows.reverse();

	return ordered.map((row, index) => {
		const previous = index > 0 ? ordered[index - 1] : null;
		const delta = previous ? row.xactCommit - previous.xactCommit : null;
		return {
			ts: row.ts.toISOString(),
			sizeBytes: row.sizeBytes,
			connections: row.connections,
			commits: delta === null || delta < 0 ? null : delta,
		};
	});
}

/**
 * Arbitrary but fixed key identifying the metrics sweep to `pg_try_advisory_lock`.
 * Changing it would let an old and a new deployment sweep concurrently.
 */
const SWEEP_LOCK_KEY = 4_120_251;

export interface SweepResult {
	ran: boolean;
	reason?: "locked" | "too-soon";
	sampled?: number;
	suspended?: number;
	errors?: number;
}

/**
 * Run a sweep only if one is actually due, and only if no other instance is running one.
 *
 * Two guards, because they stop different things. The advisory lock stops two instances
 * sweeping *simultaneously*; the freshness check stops them sweeping *alternately* and
 * sampling twice as often as configured. With one replica neither fires, but the
 * scheduler lives in the app process, so the moment anyone scales to two this is the
 * difference between a correct interval and a silently doubled one.
 *
 * The lock is session-scoped and released explicitly in `finally`; if the process dies
 * mid-sweep, Postgres drops it with the connection.
 */
export async function sweepIfDue(force = false): Promise<SweepResult> {
	const locked = await db.execute<{ locked: boolean }>(
		sql`select pg_try_advisory_lock(${SWEEP_LOCK_KEY}) as locked`,
	);
	if (!locked.rows[0]?.locked) return { ran: false, reason: "locked" };

	try {
		if (!force) {
			const [latest] = await db
				.select({ ts: databaseMetrics.ts })
				.from(databaseMetrics)
				.orderBy(desc(databaseMetrics.ts))
				.limit(1);

			// 80% of the interval: waking a little early should not skip a whole cycle.
			const floor = METRICS_INTERVAL_MS * 0.8;
			if (latest && Date.now() - latest.ts.getTime() < floor) {
				return { ran: false, reason: "too-soon" };
			}
		}

		const results = await sampleAllDatabases();
		return {
			ran: true,
			sampled: results.length,
			suspended: results.filter((r) => r.suspended).length,
			errors: results.filter((r) => r.error).length,
		};
	} finally {
		await db.execute(sql`select pg_advisory_unlock(${SWEEP_LOCK_KEY})`).catch(() => {});
	}
}

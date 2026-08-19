import "server-only";
import { and, count, eq, isNull } from "drizzle-orm";
import { adminConnectionString, buildConnectionString } from "@/lib/connection";
import { db } from "@/lib/control/db";
import { auditLog, databases, projects, type User } from "@/lib/control/schema";
import { encryptSecret, generatePassword } from "@/lib/crypto";
import { ENGINE_CONFIG, type Engine } from "@/lib/engines/types";
import { newId, physicalName, slugify } from "@/lib/id";
import { LIMITS, TTL } from "@/lib/limits";
import { bumpDatabaseCount, selectInstance } from "./placement";
import { deprovisionPostgresDatabase, provisionPostgresDatabase } from "./postgres";

export class QuotaExceededError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "QuotaExceededError";
	}
}

export class UnsupportedEngineError extends Error {
	constructor(engine: Engine) {
		super(`Provisioning for ${engine} is not implemented yet`);
		this.name = "UnsupportedEngineError";
	}
}

export interface CreateDatabaseInput {
	engine: Engine;
	/** Display name. A slug is derived from it; physical names are always generated. */
	name?: string;
	projectId?: string;
	/** Milliseconds from now. Null or omitted means no expiry. */
	ttlMs?: number | null;
	createdVia?: "dashboard" | "api" | "mcp";
}

export interface CreatedDatabase {
	id: string;
	slug: string;
	name: string;
	engine: Engine;
	connectionString: string;
	expiresAt: Date | null;
	/** Wall-clock provisioning time, so the 200ms claim stays measured rather than asserted. */
	tookMs: number;
}

/**
 * Create a tenant database end to end: quota check, placement, engine DDL, control-plane
 * row.
 *
 * Ordering is deliberate. The engine work happens *before* the control-plane row is
 * written, so a failed `CREATE DATABASE` leaves no row claiming a database that does not
 * exist. The reverse failure — engine object created, row insert fails — is handled by
 * unwinding the engine work in the catch, because an orphaned database on a shared
 * instance consumes a name and disk that nothing will ever reclaim.
 */
export async function createDatabase(
	user: User,
	input: CreateDatabaseInput,
): Promise<CreatedDatabase> {
	const started = Date.now();
	const { engine } = input;

	if (ENGINE_CONFIG[engine].tenancy !== "shared" || engine !== "postgres") {
		// Shared MySQL/MariaDB/Mongo and dedicated Redis/libsql land in step 7.
		throw new UnsupportedEngineError(engine);
	}

	await assertUnderDatabaseQuota(user.id);

	const project = input.projectId
		? await requireProject(user.id, input.projectId)
		: await ensureDefaultProject(user.id);

	const displayName = input.name?.trim() || `${engine}-db`;
	const slug = await uniqueSlug(project.id, slugify(displayName));
	const dbName = physicalName("db", slug);
	const roleName = physicalName("u", slug);
	const password = generatePassword();

	const instance = await selectInstance(engine);
	const adminUrl = adminConnectionString(
		engine,
		instance.internalHost,
		instance.port,
		instance.adminUser,
		instance.adminPasswordEnc,
	);

	await provisionPostgresDatabase({ adminUrl, dbName, roleName, password });

	const expiresAt = resolveExpiry(input.ttlMs);
	const id = newId("db");

	try {
		await db.insert(databases).values({
			id,
			projectId: project.id,
			ownerUserId: user.id,
			slug,
			name: displayName,
			engine,
			tenancy: ENGINE_CONFIG[engine].tenancy,
			instanceId: instance.id,
			dbName,
			roleName,
			passwordEnc: encryptSecret(password),
			status: "active",
			expiresAt,
			createdVia: input.createdVia ?? "dashboard",
		});
	} catch (error) {
		await deprovisionPostgresDatabase(adminUrl, dbName, roleName).catch(() => {});
		throw error;
	}

	await bumpDatabaseCount(instance.id, 1);

	await db.insert(auditLog).values({
		id: newId("db"),
		actorUserId: user.id,
		action: "database.create",
		targetType: "database",
		targetId: id,
		metadata: { engine, via: input.createdVia ?? "dashboard" },
	});

	return {
		id,
		slug,
		name: displayName,
		engine,
		connectionString: buildConnectionString({
			engine,
			slug,
			dbName,
			roleName,
			passwordEnc: encryptSecret(password),
		}),
		expiresAt,
		tookMs: Date.now() - started,
	};
}

/**
 * Drop a tenant database.
 *
 * The engine object goes first: if that succeeds and the row delete fails, the next
 * attempt is idempotent (`DROP ... IF EXISTS`). The other order would leave a row pointing
 * at nothing while the data stayed on disk.
 */
export async function destroyDatabase(user: User, databaseId: string): Promise<void> {
	const record = await db.query.databases.findFirst({
		where: and(eq(databases.id, databaseId), isNull(databases.deletedAt)),
		with: { instance: true },
	});

	if (!record || record.ownerUserId !== user.id) {
		throw new Error("Database not found");
	}

	const adminUrl = adminConnectionString(
		record.engine,
		record.instance.internalHost,
		record.instance.port,
		record.instance.adminUser,
		record.instance.adminPasswordEnc,
	);

	await deprovisionPostgresDatabase(adminUrl, record.dbName, record.roleName);

	await db
		.update(databases)
		.set({ status: "deleting", deletedAt: new Date() })
		.where(eq(databases.id, databaseId));

	await bumpDatabaseCount(record.instanceId, -1);

	await db.insert(auditLog).values({
		id: newId("db"),
		actorUserId: user.id,
		action: "database.destroy",
		targetType: "database",
		targetId: databaseId,
		metadata: { engine: record.engine },
	});
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

async function assertUnderDatabaseQuota(userId: string): Promise<void> {
	const [{ value }] = await db
		.select({ value: count() })
		.from(databases)
		.where(and(eq(databases.ownerUserId, userId), isNull(databases.deletedAt)));

	if (value >= LIMITS.DATABASES_PER_USER) {
		throw new QuotaExceededError(
			`Limit of ${LIMITS.DATABASES_PER_USER} databases reached. Delete one to create another.`,
		);
	}
}

/**
 * Agents call `POST /v1/databases` with no project, so one is created on demand. Humans
 * still get the grouping; nobody has to know projects exist to get a database (Q11).
 */
async function ensureDefaultProject(userId: string) {
	const existing = await db.query.projects.findFirst({
		where: and(eq(projects.ownerUserId, userId), eq(projects.slug, "default")),
	});
	if (existing) return existing;

	const [created] = await db
		.insert(projects)
		.values({ id: newId("proj"), ownerUserId: userId, slug: "default", name: "Default" })
		.returning();
	return created;
}

async function requireProject(userId: string, projectId: string) {
	const project = await db.query.projects.findFirst({
		where: and(eq(projects.id, projectId), eq(projects.ownerUserId, userId)),
	});
	if (!project) throw new Error("Project not found");
	return project;
}

/** Slugs are unique per project, so a second "myapp" becomes "myapp-2". */
async function uniqueSlug(projectId: string, base: string): Promise<string> {
	for (let attempt = 0; attempt < 50; attempt++) {
		const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
		const clash = await db.query.databases.findFirst({
			where: and(eq(databases.projectId, projectId), eq(databases.slug, candidate)),
		});
		if (!clash) return candidate;
	}
	return `${base}-${Date.now()}`;
}

function resolveExpiry(ttlMs?: number | null): Date | null {
	if (ttlMs === undefined || ttlMs === null) return null;
	const clamped = Math.min(Math.max(ttlMs, 60_000), TTL.MAX_MS);
	return new Date(Date.now() + clamped);
}

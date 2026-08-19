import { relations } from "drizzle-orm";
import {
	bigint,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * blaze's control plane.
 *
 * This describes blaze's *own* database — the one holding users, projects, quotas and
 * where every tenant database lives. It is not a tenant database and never contains
 * customer data. `db.crafter.run` was stateless because it was a thin proxy over Dokploy;
 * blaze cannot be, the moment it has users who are not us.
 */

export const engineEnum = pgEnum("engine", [
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
	"libsql",
]);

/** Whether a database lives on a shared instance or in its own container. */
export const tenancyEnum = pgEnum("tenancy", ["shared", "dedicated"]);

export const databaseStatusEnum = pgEnum("database_status", [
	"provisioning",
	"active",
	/** Over quota or flagged: connections rejected, data retained. */
	"suspended",
	"deleting",
	"failed",
]);

export const instanceStatusEnum = pgEnum("instance_status", [
	"provisioning",
	"active",
	/** Still serving existing tenants, but no new placements. */
	"draining",
	"offline",
]);

export const backupStatusEnum = pgEnum("backup_status", ["pending", "complete", "failed"]);

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

/**
 * Mirrors Clerk rather than replacing it. Clerk owns authentication and profile data;
 * this row exists so quotas, projects and databases have a stable local foreign key and
 * so a usage query doesn't need a network call.
 */
export const users = pgTable(
	"users",
	{
		id: text("id").primaryKey(),
		clerkUserId: text("clerk_user_id").notNull(),
		email: text("email").notNull(),
		/** Free for everyone right now. Present so billing is a migration, not a redesign. */
		plan: text("plan").notNull().default("free"),
		/** Set when a user is blocked for abuse; blocks all provisioning. */
		suspendedAt: timestamp("suspended_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("users_clerk_user_id_idx").on(t.clerkUserId),
		uniqueIndex("users_email_idx").on(t.email),
	],
);

/**
 * API keys are hashed, unlike tenant passwords. A lost key is regenerated, not recovered.
 * `keyPrefix` is stored in the clear purely so the dashboard can show `blz_live_a1b2...`
 * next to "last used 3 hours ago".
 */
export const apiKeys = pgTable(
	"api_keys",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		keyHash: text("key_hash").notNull(),
		keyPrefix: text("key_prefix").notNull(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("api_keys_key_hash_idx").on(t.keyHash),
		index("api_keys_user_id_idx").on(t.userId),
	],
);

/* ------------------------------------------------------------------ *
 * Placement — where databases physically live
 * ------------------------------------------------------------------ */

/**
 * A physical host. One row today; modelled now so that adding a second VPS is a config
 * change rather than a migration under production load (PLAN.md Q16).
 */
export const nodes = pgTable("nodes", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	/** Private address blaze reaches the node on. Never shown to users. */
	internalHost: text("internal_host").notNull(),
	region: text("region").notNull().default("default"),
	status: instanceStatusEnum("status").notNull().default("active"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A running engine process that can hold tenants.
 *
 * For shared engines this is one big Postgres/MySQL/Mongo serving many tenants. For
 * dedicated engines (redis, libsql) one instance row corresponds to one tenant's own
 * container, provisioned through Dokploy — hence `dokployServiceId`.
 */
export const instances = pgTable(
	"instances",
	{
		id: text("id").primaryKey(),
		nodeId: text("node_id")
			.notNull()
			.references(() => nodes.id),
		engine: engineEnum("engine").notNull(),
		tenancy: tenancyEnum("tenancy").notNull(),
		version: text("version").notNull(),
		/** How blaze connects to administer it, e.g. `blaze-pg-1:5432`. */
		internalHost: text("internal_host").notNull(),
		port: integer("port").notNull(),
		adminUser: text("admin_user").notNull(),
		/** Encrypted with ENCRYPTION_KEY — see lib/crypto.ts. */
		adminPasswordEnc: text("admin_password_enc").notNull(),
		/** Set only for dedicated containers. */
		dokployServiceId: text("dokploy_service_id"),
		/** Soft cap used by placement; not enforced by the engine itself. */
		capacity: integer("capacity").notNull().default(500),
		databaseCount: integer("database_count").notNull().default(0),
		status: instanceStatusEnum("status").notNull().default("provisioning"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("instances_placement_idx").on(t.engine, t.tenancy, t.status)],
);

/* ------------------------------------------------------------------ *
 * Tenant resources
 * ------------------------------------------------------------------ */

/**
 * Projects group databases. Auto-created as "default" on first use so an agent can call
 * `POST /v1/databases` with no prior setup, while humans still get structure (Q11).
 */
export const projects = pgTable(
	"projects",
	{
		id: text("id").primaryKey(),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex("projects_owner_slug_idx").on(t.ownerUserId, t.slug)],
);

export const databases = pgTable(
	"databases",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		engine: engineEnum("engine").notNull(),
		tenancy: tenancyEnum("tenancy").notNull(),
		instanceId: text("instance_id")
			.notNull()
			.references(() => instances.id),

		/** Physical names on the instance. Generated, never user-supplied — see lib/id.ts. */
		dbName: text("db_name").notNull(),
		roleName: text("role_name").notNull(),
		/** Encrypted, not hashed: the connection string has to be displayable. */
		passwordEnc: text("password_enc").notNull(),

		status: databaseStatusEnum("status").notNull().default("provisioning"),
		/** Last observed size, refreshed by the metrics poller. Drives quota enforcement. */
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
		/** Null means no expiry. The reaper deletes rows whose expiry has passed. */
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		/** How this was created, so we can see what agents actually do. */
		createdVia: text("created_via").notNull().default("dashboard"),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("databases_project_slug_idx").on(t.projectId, t.slug),
		uniqueIndex("databases_instance_dbname_idx").on(t.instanceId, t.dbName),
		index("databases_owner_idx").on(t.ownerUserId),
		/** The reaper's query: everything with an expiry that has passed. */
		index("databases_expires_at_idx").on(t.expiresAt),
	],
);

/* ------------------------------------------------------------------ *
 * Observability and durability
 * ------------------------------------------------------------------ */

/**
 * Per-database metrics, polled from engine-native stats every 5 minutes.
 *
 * Dokploy's container metrics describe a whole shared instance and so say nothing about
 * an individual tenant. `pg_database_size()` has to be polled anyway to enforce the
 * storage quota, so the chart history falls out of work already being done (PLAN.md §7).
 */
export const databaseMetrics = pgTable(
	"database_metrics",
	{
		databaseId: text("database_id")
			.notNull()
			.references(() => databases.id, { onDelete: "cascade" }),
		ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
		connections: integer("connections").notNull().default(0),
		/** Cumulative commit counter; charts render the delta between samples. */
		xactCommit: bigint("xact_commit", { mode: "number" }).notNull().default(0),
	},
	(t) => [index("database_metrics_db_ts_idx").on(t.databaseId, t.ts)],
);

export const backups = pgTable(
	"backups",
	{
		id: text("id").primaryKey(),
		databaseId: text("database_id")
			.notNull()
			.references(() => databases.id, { onDelete: "cascade" }),
		/** Object key in MinIO. */
		objectKey: text("object_key").notNull(),
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
		status: backupStatusEnum("status").notNull().default("pending"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => [index("backups_database_idx").on(t.databaseId, t.createdAt)],
);

/**
 * Append-only record of consequential actions. Free public infrastructure attracts abuse,
 * and when it happens the question is always "what did this account actually do".
 */
export const auditLog = pgTable(
	"audit_log",
	{
		id: text("id").primaryKey(),
		actorUserId: text("actor_user_id"),
		action: text("action").notNull(),
		targetType: text("target_type"),
		targetId: text("target_id"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("audit_log_actor_idx").on(t.actorUserId, t.createdAt)],
);

/* ------------------------------------------------------------------ *
 * Relations
 * ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many }) => ({
	projects: many(projects),
	databases: many(databases),
	apiKeys: many(apiKeys),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
	owner: one(users, { fields: [projects.ownerUserId], references: [users.id] }),
	databases: many(databases),
}));

export const databasesRelations = relations(databases, ({ one, many }) => ({
	project: one(projects, { fields: [databases.projectId], references: [projects.id] }),
	owner: one(users, { fields: [databases.ownerUserId], references: [users.id] }),
	instance: one(instances, { fields: [databases.instanceId], references: [instances.id] }),
	metrics: many(databaseMetrics),
	backups: many(backups),
}));

export const instancesRelations = relations(instances, ({ one, many }) => ({
	node: one(nodes, { fields: [instances.nodeId], references: [nodes.id] }),
	databases: many(databases),
}));

export const nodesRelations = relations(nodes, ({ many }) => ({
	instances: many(instances),
}));

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Database = typeof databases.$inferSelect;
export type Instance = typeof instances.$inferSelect;
export type Node = typeof nodes.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Backup = typeof backups.$inferSelect;

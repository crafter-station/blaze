CREATE TYPE "public"."backup_status" AS ENUM('pending', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."database_status" AS ENUM('provisioning', 'active', 'suspended', 'deleting', 'failed');--> statement-breakpoint
CREATE TYPE "public"."engine" AS ENUM('postgres', 'mysql', 'mariadb', 'mongo', 'redis', 'libsql');--> statement-breakpoint
CREATE TYPE "public"."instance_status" AS ENUM('provisioning', 'active', 'draining', 'offline');--> statement-breakpoint
CREATE TYPE "public"."tenancy" AS ENUM('shared', 'dedicated');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" text PRIMARY KEY NOT NULL,
	"database_id" text NOT NULL,
	"object_key" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"status" "backup_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "database_metrics" (
	"database_id" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"size_bytes" bigint NOT NULL,
	"connections" integer DEFAULT 0 NOT NULL,
	"xact_commit" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "databases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"engine" "engine" NOT NULL,
	"tenancy" "tenancy" NOT NULL,
	"instance_id" text NOT NULL,
	"db_name" text NOT NULL,
	"role_name" text NOT NULL,
	"password_enc" text NOT NULL,
	"status" "database_status" DEFAULT 'provisioning' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_via" text DEFAULT 'dashboard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"engine" "engine" NOT NULL,
	"tenancy" "tenancy" NOT NULL,
	"version" text NOT NULL,
	"internal_host" text NOT NULL,
	"port" integer NOT NULL,
	"admin_user" text NOT NULL,
	"admin_password_enc" text NOT NULL,
	"dokploy_service_id" text,
	"capacity" integer DEFAULT 500 NOT NULL,
	"database_count" integer DEFAULT 0 NOT NULL,
	"status" "instance_status" DEFAULT 'provisioning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"internal_host" text NOT NULL,
	"region" text DEFAULT 'default' NOT NULL,
	"status" "instance_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_metrics" ADD CONSTRAINT "database_metrics_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "backups_database_idx" ON "backups" USING btree ("database_id","created_at");--> statement-breakpoint
CREATE INDEX "database_metrics_db_ts_idx" ON "database_metrics" USING btree ("database_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "databases_project_slug_idx" ON "databases" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "databases_instance_dbname_idx" ON "databases" USING btree ("instance_id","db_name");--> statement-breakpoint
CREATE INDEX "databases_owner_idx" ON "databases" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "databases_expires_at_idx" ON "databases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "instances_placement_idx" ON "instances" USING btree ("engine","tenancy","status");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_owner_slug_idx" ON "projects" USING btree ("owner_user_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_clerk_user_id_idx" ON "users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
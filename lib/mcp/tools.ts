import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { serializeDatabase } from "@/lib/api/serialize";
import { ApiKeyLimitError, createApiKey } from "@/lib/api-keys";
import { db } from "@/lib/control/db";
import { databases, type User } from "@/lib/control/schema";
import { ENGINES } from "@/lib/engines/types";
import { LIMITS, TTL } from "@/lib/limits";
import { createDatabase, destroyDatabase, getOwnedDatabase } from "@/lib/provision";
import { runTenantQuery } from "@/lib/query";

/**
 * The tools blaze exposes over MCP.
 *
 * Descriptions are written for a model, not a developer. A model decides whether to call
 * a tool from its description alone, so each one states what it does, what it costs, and
 * the constraint most likely to trip it up — the database limit, the TTL default, the
 * fact that `run_query` reaches only databases this key owns. Vague descriptions produce
 * agents that either never call the tool or call it wrongly and retry.
 */

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export const TOOLS: ToolDefinition[] = [
	{
		name: "create_database",
		description:
			`Provision a new managed database and return a ready-to-use connection string. ` +
			`Takes roughly 200ms. Use this whenever you need a real database to work against — ` +
			`for a test fixture, a scratch schema, or a user's app. ` +
			`Set ttl_seconds for throwaway work so it cleans itself up; 86400 (24h) is a sensible ` +
			`default for anything experimental. Limit: ${LIMITS.DATABASES_PER_USER} databases per ` +
			`account, ${LIMITS.STORAGE_BYTES / 1024 / 1024}MB each. Only postgres is available today.`,
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Human-readable name, e.g. 'checkout-tests'." },
				engine: { type: "string", enum: ENGINES, description: "Defaults to postgres." },
				ttl_seconds: {
					type: "number",
					description: `Auto-delete after this many seconds. Omit for no expiry. Max ${TTL.MAX_MS / 1000}.`,
				},
			},
		},
	},
	{
		name: "list_databases",
		description:
			"List every database this API key owns, with status, size and expiry. Call this " +
			"before creating one if you might already have a suitable database, since the " +
			"account limit is small.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_connection_string",
		description:
			"Return the full connection string, including credentials, for one database. " +
			"Use when you already know the database id and need to hand credentials to an app " +
			"or a client library.",
		inputSchema: {
			type: "object",
			properties: { database_id: { type: "string" } },
			required: ["database_id"],
		},
	},
	{
		name: "run_query",
		description:
			"Execute SQL against a database this key owns and return the rows. Use it to create " +
			"schema, seed data, and inspect results without needing a Postgres driver or network " +
			"access to the instance. Runs as that database's own role, so it can reach nothing " +
			"else. Statements time out after 30s and at most 500 rows come back. A SQL error is " +
			"reported in the result rather than as a failure — read `ok` before trusting `rows`.",
		inputSchema: {
			type: "object",
			properties: {
				database_id: { type: "string" },
				sql: {
					type: "string",
					description: "One or more statements. The last result is returned.",
				},
			},
			required: ["database_id", "sql"],
		},
	},
	{
		name: "set_ttl",
		description:
			"Change or clear a database's auto-delete time. Pass ttl_seconds to set it, or null " +
			"to keep the database indefinitely.",
		inputSchema: {
			type: "object",
			properties: {
				database_id: { type: "string" },
				ttl_seconds: { type: ["number", "null"] },
			},
			required: ["database_id"],
		},
	},
	{
		name: "create_api_key",
		description:
			"Mint a blaze API key for the user's own application, CI, or scripts. Use this when " +
			"they need blaze credentials somewhere that cannot do an OAuth browser flow. The key " +
			"is returned once and cannot be retrieved again, so surface it to the user " +
			"immediately and tell them to store it. You do not need a key yourself — you are " +
			"already authenticated.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "What it is for, e.g. 'production app'." },
			},
			required: ["name"],
		},
	},
	{
		name: "delete_database",
		description:
			"Permanently delete a database and all its data. There is no backup and no undo. " +
			"Prefer set_ttl for work that should expire on its own.",
		inputSchema: {
			type: "object",
			properties: { database_id: { type: "string" } },
			required: ["database_id"],
		},
	},
];

type Args = Record<string, unknown>;

/** Result payload for a tool call. `isError` maps to MCP's error flag. */
export interface ToolResult {
	text: string;
	isError?: boolean;
}

function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export async function callTool(user: User, name: string, args: Args): Promise<ToolResult> {
	switch (name) {
		case "create_database": {
			const ttl = typeof args.ttl_seconds === "number" ? args.ttl_seconds * 1000 : null;
			const created = await createDatabase(user, {
				engine: (args.engine as (typeof ENGINES)[number]) ?? "postgres",
				name: typeof args.name === "string" ? args.name : undefined,
				ttlMs: ttl,
				createdVia: "mcp",
			});
			return {
				text: json({
					id: created.id,
					name: created.name,
					engine: created.engine,
					connection_string: created.connectionString,
					expires_at: created.expiresAt?.toISOString() ?? null,
					took_ms: created.tookMs,
				}),
			};
		}

		case "list_databases": {
			const rows = await db.query.databases.findMany({
				where: and(eq(databases.ownerUserId, user.id), isNull(databases.deletedAt)),
				orderBy: [desc(databases.createdAt)],
			});
			return {
				text: json({
					count: rows.length,
					limit: LIMITS.DATABASES_PER_USER,
					databases: rows.map((row) => serializeDatabase(row)),
				}),
			};
		}

		case "get_connection_string": {
			const record = await getOwnedDatabase(user.id, String(args.database_id));
			if (!record) return { text: "No database with that id.", isError: true };
			return { text: json(serializeDatabase(record, true)) };
		}

		case "run_query": {
			const record = await getOwnedDatabase(user.id, String(args.database_id));
			if (!record) return { text: "No database with that id.", isError: true };
			if (record.status === "suspended") {
				return { text: "Database is suspended — free storage to resume it.", isError: true };
			}
			const result = await runTenantQuery(record, String(args.sql));
			return {
				text: json({
					ok: result.ok,
					error: result.error ?? null,
					command: result.command ?? null,
					columns: result.columns ?? [],
					rows: result.rows ?? [],
					row_count: result.rowCount ?? 0,
					truncated: result.truncated ?? false,
					duration_ms: result.durationMs ?? 0,
				}),
			};
		}

		case "set_ttl": {
			const record = await getOwnedDatabase(user.id, String(args.database_id));
			if (!record) return { text: "No database with that id.", isError: true };
			const seconds = args.ttl_seconds;
			const expiresAt = typeof seconds === "number" ? new Date(Date.now() + seconds * 1000) : null;
			await db.update(databases).set({ expiresAt }).where(eq(databases.id, record.id));
			return { text: json({ id: record.id, expires_at: expiresAt?.toISOString() ?? null }) };
		}

		case "create_api_key": {
			try {
				const key = await createApiKey(user, String(args.name ?? "agent-created"));
				return {
					text: json({
						id: key.id,
						name: key.name,
						api_key: key.token,
						warning: "Shown once. blaze stores only a hash — it cannot be recovered.",
					}),
				};
			} catch (error) {
				if (error instanceof ApiKeyLimitError) return { text: error.message, isError: true };
				throw error;
			}
		}

		case "delete_database": {
			try {
				await destroyDatabase(user, String(args.database_id));
				return { text: json({ deleted: true, id: args.database_id }) };
			} catch (error) {
				return {
					text: error instanceof Error ? error.message : "Failed to delete.",
					isError: true,
				};
			}
		}

		default:
			return { text: `Unknown tool: ${name}`, isError: true };
	}
}

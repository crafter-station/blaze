import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { apiError, apiJson, authenticate, isResponse, readBody } from "@/lib/api/http";
import { serializeDatabase } from "@/lib/api/serialize";
import { db } from "@/lib/control/db";
import { databases } from "@/lib/control/schema";
import { ENGINES } from "@/lib/engines/types";
import { TTL } from "@/lib/limits";
import { createDatabase, QuotaExceededError, UnsupportedEngineError } from "@/lib/provision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CreateBody = z.object({
	engine: z.enum(ENGINES as [string, ...string[]]).default("postgres"),
	name: z.string().max(60).optional(),
	project_id: z.string().optional(),
	/**
	 * Seconds, not milliseconds. Every other TTL an agent has seen is in seconds, and a
	 * caller who guesses wrong should get a database that lives 24 hours instead of 24
	 * seconds — so the unit is named in the field itself.
	 */
	ttl_seconds: z
		.number()
		.int()
		.positive()
		.max(TTL.MAX_MS / 1000)
		.nullable()
		.optional(),
});

export async function GET(request: Request) {
	const user = await authenticate(request);
	if (isResponse(user)) return user;

	const rows = await db.query.databases.findMany({
		where: and(eq(databases.ownerUserId, user.id), isNull(databases.deletedAt)),
		orderBy: [desc(databases.createdAt)],
	});

	return apiJson({ databases: rows.map((row) => serializeDatabase(row)) });
}

/**
 * Create a database.
 *
 * Returns the connection string, because the entire point is that one call gets an agent
 * a usable database — making it fetch credentials separately would double the round trips
 * for no benefit, and the caller is already authenticated to see them.
 */
export async function POST(request: Request) {
	const user = await authenticate(request);
	if (isResponse(user)) return user;

	const body = await readBody(request, CreateBody);
	if (isResponse(body)) return body;

	try {
		const created = await createDatabase(user, {
			engine: body.engine as (typeof ENGINES)[number],
			name: body.name,
			projectId: body.project_id,
			ttlMs: body.ttl_seconds ? body.ttl_seconds * 1000 : null,
			createdVia: "api",
		});

		const record = await db.query.databases.findFirst({
			where: eq(databases.id, created.id),
		});
		if (!record) return apiError("internal", "Database was created but could not be read back.");

		return apiJson({ ...serializeDatabase(record, true), took_ms: created.tookMs }, 201);
	} catch (error) {
		if (error instanceof QuotaExceededError) return apiError("quota_exceeded", error.message);
		if (error instanceof UnsupportedEngineError) {
			return apiError("unsupported_engine", error.message);
		}
		return apiError(
			"internal",
			error instanceof Error ? error.message : "Failed to create database.",
		);
	}
}

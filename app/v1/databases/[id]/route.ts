import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, apiJson, authenticate, isResponse, readBody } from "@/lib/api/http";
import { serializeDatabase } from "@/lib/api/serialize";
import { db } from "@/lib/control/db";
import { databases } from "@/lib/control/schema";
import { TTL } from "@/lib/limits";
import { destroyDatabase, getOwnedDatabase } from "@/lib/provision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PatchBody = z.object({
	name: z.string().min(1).max(60).optional(),
	/** null clears the expiry; omitted leaves it untouched. */
	ttl_seconds: z
		.number()
		.int()
		.positive()
		.max(TTL.MAX_MS / 1000)
		.nullable()
		.optional(),
});

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
	const user = await authenticate(request);
	if (isResponse(user)) return user;

	const { id } = await ctx.params;
	const record = await getOwnedDatabase(user.id, id);
	if (!record) return apiError("not_found", "No database with that id.");

	// Credentials on the single-database read: this is the "I lost my connection string"
	// call, and the caller already holds a key that could delete the database.
	return apiJson(serializeDatabase(record, true));
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
	const user = await authenticate(request);
	if (isResponse(user)) return user;

	const { id } = await ctx.params;
	const record = await getOwnedDatabase(user.id, id);
	if (!record) return apiError("not_found", "No database with that id.");

	const body = await readBody(request, PatchBody);
	if (isResponse(body)) return body;

	const patch: { name?: string; expiresAt?: Date | null } = {};
	if (body.name !== undefined) patch.name = body.name;
	// `in` rather than a truthiness check, so an explicit null clears the expiry instead of
	// being indistinguishable from "not provided".
	if ("ttl_seconds" in body) {
		patch.expiresAt = body.ttl_seconds ? new Date(Date.now() + body.ttl_seconds * 1000) : null;
	}

	if (Object.keys(patch).length === 0) {
		return apiError("invalid_request", "Nothing to update. Provide name and/or ttl_seconds.");
	}

	const [updated] = await db.update(databases).set(patch).where(eq(databases.id, id)).returning();

	return apiJson(serializeDatabase(updated));
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
	const user = await authenticate(request);
	if (isResponse(user)) return user;

	const { id } = await ctx.params;

	try {
		await destroyDatabase(user, id);
		return apiJson({ deleted: true, id });
	} catch (error) {
		// destroyDatabase raises the same error for missing and not-owned, deliberately.
		return apiError("not_found", error instanceof Error ? error.message : "Not found.");
	}
}

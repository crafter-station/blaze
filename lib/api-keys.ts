import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "./control/db";
import { apiKeys, type User, users } from "./control/schema";
import { generateApiKey, hashApiKey } from "./crypto";
import { newId } from "./id";
import { LIMITS } from "./limits";

/**
 * API keys are how agents and scripts authenticate to `/v1`, as opposed to the Clerk
 * session the dashboard uses.
 *
 * Only the SHA-256 hash is stored. The full token is returned exactly once, at creation,
 * and is unrecoverable afterwards — a key that can be re-read from the database is a key
 * that leaks with the database. `keyPrefix` is kept in the clear purely so the UI can
 * identify a row without being able to authenticate as it.
 */

export class ApiKeyLimitError extends Error {
	constructor() {
		super(`Limit of ${LIMITS.API_KEYS_PER_USER} API keys reached. Revoke one to create another.`);
		this.name = "ApiKeyLimitError";
	}
}

export interface CreatedApiKey {
	id: string;
	name: string;
	/** Shown once. Never retrievable again. */
	token: string;
	prefix: string;
}

export async function createApiKey(user: User, name: string): Promise<CreatedApiKey> {
	const [{ value }] = await db
		.select({ value: count() })
		.from(apiKeys)
		.where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)));

	if (value >= LIMITS.API_KEYS_PER_USER) throw new ApiKeyLimitError();

	const { token, prefix, hash } = generateApiKey();
	const id = newId("key");

	await db.insert(apiKeys).values({
		id,
		userId: user.id,
		name: name.trim() || "Untitled key",
		keyHash: hash,
		keyPrefix: prefix,
	});

	return { id, name, token, prefix };
}

export async function listApiKeys(userId: string) {
	return db.query.apiKeys.findMany({
		where: and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)),
		orderBy: [desc(apiKeys.createdAt)],
	});
}

/**
 * Revocation is a soft delete. The row stays so `last_used_at` and the prefix remain
 * available for an audit conversation after a key is burned — "when did this key last
 * work" is exactly the question you need answered once a key has leaked.
 */
export async function revokeApiKey(user: User, keyId: string): Promise<void> {
	const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, keyId) });
	if (!key || key.userId !== user.id) throw new Error("API key not found");

	await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, keyId));
}

/**
 * Resolve a bearer token to a user, for `/v1` requests.
 *
 * Lookup is by hash, which is uniquely indexed — so this is a single indexed read and
 * there is no candidate set to compare against in constant time. A revoked or unknown key
 * returns null; the caller must not distinguish between them in its response.
 */
export async function authenticateApiKey(token: string): Promise<User | null> {
	if (!token.startsWith("blz_")) return null;

	const key = await db.query.apiKeys.findFirst({
		where: and(eq(apiKeys.keyHash, hashApiKey(token)), isNull(apiKeys.revokedAt)),
	});
	if (!key) return null;

	const user = await db.query.users.findFirst({ where: eq(users.id, key.userId) });
	if (!user || user.suspendedAt) return null;

	// Best-effort: a failed timestamp update must never fail an otherwise valid request.
	db.update(apiKeys)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiKeys.id, key.id))
		.catch(() => {});

	return user;
}

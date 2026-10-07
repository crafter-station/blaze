import "server-only";
import { requireUser } from "@/lib/auth";
import { getOwnedDatabase } from "@/lib/provision";
import { RedisCommandError, RedisConnectionError, RedisReplyTooLargeError } from "./client";
import { friendlyRedisError } from "./reply";
import type { Failure } from "./types";

/**
 * Resolve a Redis database the signed-in user owns, for the console and browser actions.
 *
 * The id from the client is only ever a reference: ownership is checked against the
 * session on every call, exactly as the SQL console's actions do. A database that does
 * not exist and one that belongs to someone else are indistinguishable from here.
 */

export type OwnedRedis = NonNullable<Awaited<ReturnType<typeof getOwnedDatabase>>>;

export async function ownedRedisDatabase(
	databaseId: string,
): Promise<{ record: OwnedRedis } | Failure> {
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, String(databaseId));
	if (record?.engine !== "redis") return { ok: false, error: "Database not found" };
	if (record.status === "suspended") {
		return {
			ok: false,
			error: "This database is suspended. Free memory to resume it.",
		};
	}
	if (record.status !== "active") {
		return { ok: false, error: `This database is ${record.status} and cannot be queried yet.` };
	}
	return { record };
}

/** An error as the browser shows it: the engine's words, plus a plain reading when there is one. */
export function describeRedisError(error: unknown, fallback = "Redis request failed"): Failure {
	if (
		error instanceof RedisCommandError ||
		error instanceof RedisConnectionError ||
		error instanceof RedisReplyTooLargeError
	) {
		const friendly = friendlyRedisError(error.message) ?? undefined;
		return { ok: false, error: error.message, ...(friendly && { friendly }) };
	}
	return { ok: false, error: error instanceof Error ? error.message : fallback };
}

"use server";

import { describeRedisError, ownedRedisDatabase } from "@/lib/redis/access";
import { commandReference } from "@/lib/redis/reference";
import { MAX_CONSOLE_LINES, runConsoleLines } from "@/lib/redis/run";
import type { CommandReference, ConsoleRun, Failure } from "@/lib/redis/types";

/**
 * Server actions behind the Redis console.
 *
 * Every call resolves the database through ownership first (lib/redis/access.ts), then
 * connects as the tenant's own `default` user. The ACL on that user is the boundary;
 * the console's own rules (blocked commands, capped timeouts, confirmations) are there so
 * a short-lived request connection behaves predictably, not to grant or deny access.
 */

export async function runRedisAction(
	databaseId: string,
	lines: string[],
	confirmed = false,
): Promise<ConsoleRun> {
	const owned = await ownedRedisDatabase(databaseId);
	if ("error" in owned) return { results: [], error: owned.error };

	const list = (Array.isArray(lines) ? lines : []).map((l) => String(l)).filter((l) => l.trim());
	if (list.length === 0) return { results: [], error: "Nothing to run" };
	if (list.length > MAX_CONSOLE_LINES) {
		return { results: [], error: `Run at most ${MAX_CONSOLE_LINES} commands at a time.` };
	}
	for (const line of list) {
		if (line.length > 512_000) return { results: [], error: "A command is longer than 512 KB." };
	}
	return runConsoleLines(owned.record, list, confirmed === true);
}

export async function commandReferenceAction(
	databaseId: string,
): Promise<({ ok: true } & CommandReference) | Failure> {
	const owned = await ownedRedisDatabase(databaseId);
	if ("error" in owned) return owned;
	try {
		return { ok: true, ...(await commandReference(owned.record)) };
	} catch (error) {
		return describeRedisError(error, "Could not read the command reference");
	}
}

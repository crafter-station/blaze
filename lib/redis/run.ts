import "server-only";
import type { OwnedRedis } from "./access";
import { capBlockingTimeout, classify } from "./classify";
import type { RedisConnection } from "./client";
import { friendlyRedisError, toReply } from "./reply";
import { connectTenantRedis } from "./tenant";
import { tokenize } from "./tokenize";
import type { CommandOutcome, ConsoleRun } from "./types";

/** Lines one console run may hold. */
export const MAX_CONSOLE_LINES = 50;
/** Longest a whole run may take before the remaining lines are skipped. */
export const RUN_BUDGET_MS = 25_000;

/**
 * Run console lines in order on one connection, as the tenant.
 *
 * Unlike a SQL batch, a failing line does not stop the run: redis-cli carries on, and
 * `MULTI` / `EXEC` across lines only works if every line reaches the same connection.
 * Lines that need confirmation run only with `confirmed`, so a request that skipped the
 * dialog (a stale tab, a script) cannot flush a database by accident.
 */
export async function runConsoleLines(
	record: OwnedRedis,
	lines: string[],
	confirmed: boolean,
): Promise<ConsoleRun> {
	const started = Date.now();
	const results: CommandOutcome[] = [];
	let conn: RedisConnection | null = null;
	let lost: string | null = null;

	try {
		for (const line of lines) {
			const t0 = Date.now();
			const done = (outcome: Omit<CommandOutcome, "line" | "durationMs">) =>
				results.push({ line, durationMs: Date.now() - t0, ...outcome });

			if (lost) {
				done({ ok: false, kind: "skipped", error: "Not run: the connection was lost." });
				continue;
			}
			if (Date.now() - started > RUN_BUDGET_MS) {
				done({ ok: false, kind: "skipped", error: "Not run: the run took too long." });
				continue;
			}

			const parsed = tokenize(line);
			if (parsed.error) {
				done({ ok: false, kind: "syntax", error: `Invalid argument(s): ${parsed.error}` });
				continue;
			}
			if (parsed.tokens.length === 0) continue;

			const words = parsed.tokens.map((t) => t.text);
			const verdict = classify(words);
			if (verdict.blocked) {
				done({ ok: false, kind: "blocked", error: verdict.blocked });
				continue;
			}
			if (verdict.confirm && !confirmed) {
				done({
					ok: false,
					kind: "confirm",
					error: `Not run without confirmation. ${verdict.confirm}`,
				});
				continue;
			}

			const capped = capBlockingTimeout(words);
			const args: (string | Uint8Array)[] = parsed.tokens.map((t) => t.bytes);
			if (capped.index !== undefined) args[capped.index] = capped.args[capped.index];

			try {
				conn ??= await connectTenantRedis(record, { clientName: "blaze-console" });
				const value = await conn.call(args);
				const { reply, truncated } = toReply(value);
				const isError = reply.t === "error";
				const friendly = isError ? (friendlyRedisError(reply.v) ?? undefined) : undefined;
				done({
					ok: !isError,
					reply,
					...(truncated && { truncated }),
					...(capped.note && { note: capped.note }),
					...(friendly && { friendly }),
				});
			} catch (error) {
				lost = error instanceof Error ? error.message : "The connection to Redis failed.";
				done({
					ok: false,
					kind: "connection",
					error: lost,
					friendly: friendlyRedisError(lost) ?? undefined,
				});
			}
		}
	} finally {
		(conn as RedisConnection | null)?.close();
	}
	return { results };
}

/**
 * What the console does with a command before it reaches Redis.
 *
 * None of this is a security boundary: the tenant's ACL user is. These rules exist
 * because the console runs every request on a short-lived connection with a short
 * timeout, and some commands only make sense on a long-lived one, while a few others are
 * destructive enough to deserve a second look.
 *
 * - **blocked**: needs a persistent connection (pub/sub, MONITOR, replication streams) or
 *   would switch the protocol under the console. Refused with an explanation.
 * - **blocking**: waits for data. Allowed, but its timeout is capped so a forgotten
 *   `BLPOP q 0` returns within seconds instead of hanging the request.
 * - **confirm**: wipes data in bulk (FLUSHDB, FLUSHALL, DEL/UNLINK of several keys).
 */

/** Longest a blocking command may wait, in seconds. */
export const BLOCKING_CAP_SECONDS = 5;

export interface Classification {
	/** Upper-cased command name, with the subcommand for container commands (`CLIENT LIST`). */
	name: string;
	blocked?: string;
	confirm?: string;
}

const BLOCKED: Record<string, string> = {
	SUBSCRIBE:
		"SUBSCRIBE needs a connection that stays open to receive messages. The console runs each command on a short-lived connection, so use a client such as redis-cli for pub/sub.",
	PSUBSCRIBE:
		"PSUBSCRIBE needs a connection that stays open to receive messages. Use a client such as redis-cli for pub/sub.",
	SSUBSCRIBE:
		"SSUBSCRIBE needs a connection that stays open to receive messages. Use a client such as redis-cli for pub/sub.",
	MONITOR:
		"MONITOR streams every command for as long as the connection stays open, which the console cannot do. Use redis-cli --tls MONITOR from your machine.",
	SYNC: "SYNC starts a replication stream and is not available from the console.",
	PSYNC: "PSYNC starts a replication stream and is not available from the console.",
	HELLO:
		"The console already negotiates the protocol (RESP3) on every connection. HELLO is not available here.",
	RESET:
		"RESET clears connection state that the console manages itself. Each run already starts on a fresh connection.",
	QUIT: "Each run already uses its own connection, closed when it finishes. QUIT is not needed.",
};

export function commandName(args: string[]): string {
	const first = (args[0] ?? "").toUpperCase();
	return first;
}

/** Container commands whose second word selects what actually runs. */
const CONTAINERS = new Set([
	"ACL",
	"CLIENT",
	"CLUSTER",
	"COMMAND",
	"CONFIG",
	"FUNCTION",
	"LATENCY",
	"MEMORY",
	"MODULE",
	"OBJECT",
	"PUBSUB",
	"SCRIPT",
	"SLOWLOG",
	"XINFO",
	"XGROUP",
	"DEBUG",
]);

export function classify(args: string[]): Classification {
	const first = commandName(args);
	const name = CONTAINERS.has(first) && args[1] ? `${first} ${args[1].toUpperCase()}` : first;

	if (BLOCKED[first]) return { name, blocked: BLOCKED[first] };
	if (name === "CLIENT REPLY") {
		return {
			name,
			blocked: "CLIENT REPLY would make the console wait for replies that never come.",
		};
	}

	if (first === "FLUSHDB" || first === "FLUSHALL") {
		return { name, confirm: `${first} deletes every key in this database. It cannot be undone.` };
	}
	if ((first === "DEL" || first === "UNLINK") && args.length > 2) {
		return { name, confirm: `${first} removes ${args.length - 1} keys at once.` };
	}
	return { name };
}

export interface TimeoutRewrite {
	args: string[];
	/** Position of the rewritten argument, when one was rewritten. */
	index?: number;
	/** Set when the timeout was changed, to explain why to the user. */
	note?: string;
}

/** Where a blocking command keeps its timeout, and in what unit. */
function timeoutIndex(args: string[]): { index: number; unit: "s" | "ms" } | null {
	const name = commandName(args);
	switch (name) {
		case "BLPOP":
		case "BRPOP":
		case "BZPOPMIN":
		case "BZPOPMAX":
		case "BRPOPLPUSH":
		case "BLMOVE":
			return args.length >= 3 ? { index: args.length - 1, unit: "s" } : null;
		case "BLMPOP":
		case "BZMPOP":
			return args.length >= 2 ? { index: 1, unit: "s" } : null;
		case "WAIT":
			return args.length >= 3 ? { index: 2, unit: "ms" } : null;
		case "WAITAOF":
			return args.length >= 4 ? { index: 3, unit: "ms" } : null;
		case "XREAD":
		case "XREADGROUP": {
			// `BLOCK ms` is an option before STREAMS; key names after STREAMS may be "block".
			for (let i = 1; i < args.length; i++) {
				const word = args[i].toUpperCase();
				if (word === "STREAMS") return null;
				if (word === "BLOCK" && i + 1 < args.length) return { index: i + 1, unit: "ms" };
			}
			return null;
		}
		default:
			return null;
	}
}

export function isBlockingCommand(args: string[]): boolean {
	return timeoutIndex(args) !== null;
}

/**
 * Cap a blocking command's timeout at `BLOCKING_CAP_SECONDS`.
 *
 * Zero means "wait forever" to Redis, so it is capped too. A timeout that is not a number
 * is left alone: Redis rejects it with its own, accurate error.
 */
export function capBlockingTimeout(
	args: string[],
	capSeconds = BLOCKING_CAP_SECONDS,
): TimeoutRewrite {
	const at = timeoutIndex(args);
	if (!at) return { args };
	const raw = args[at.index];
	const value = Number(raw);
	if (raw.trim() === "" || !Number.isFinite(value) || value < 0) return { args };

	const cap = at.unit === "s" ? capSeconds : capSeconds * 1000;
	if (value !== 0 && value <= cap) return { args };

	const next = [...args];
	next[at.index] = String(cap);
	const unit = at.unit === "s" ? "s" : "ms";
	const was = value === 0 ? "0 (wait forever)" : `${raw}${unit === "s" ? "s" : " ms"}`;
	return {
		args: next,
		index: at.index,
		note: `Timeout ${was} capped at ${capSeconds}s: the console does not keep connections open longer.`,
	};
}

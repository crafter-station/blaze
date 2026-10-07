import type { RespValue } from "./resp";
import { escapeBytes } from "./tokenize";

/**
 * Replies as the browser receives them: JSON-safe, typed by RESP type, and capped.
 *
 * A tenant can hold 64 MB, and `LRANGE big 0 -1` would happily try to ship all of it to
 * a browser tab. The caps bound both the number of elements (across the whole tree) and
 * the bytes of string payload; anything past them is dropped and the reply says so.
 */

export type Reply =
	| { t: "simple"; v: string }
	| { t: "error"; v: string }
	| { t: "int"; v: string }
	| { t: "double"; v: string }
	| { t: "big"; v: string }
	| { t: "bool"; v: boolean }
	| { t: "nil" }
	| {
			t: "bulk";
			/** Text when the bytes are UTF-8, otherwise the redis-cli escaped form. */
			v: string;
			/** Byte length of the full value, which may be more than was shipped. */
			len: number;
			binary?: boolean;
			/** Hex of the shipped bytes, only for binary values. */
			hex?: string;
			truncated?: boolean;
	  }
	| { t: "verbatim"; format: string; v: string; truncated?: boolean }
	| { t: "array" | "set" | "push"; items: Reply[]; len: number; truncated?: boolean }
	| { t: "map"; entries: [Reply, Reply][]; len: number; truncated?: boolean };

export interface ReplyCaps {
	/** Elements across the whole reply tree. */
	maxElements: number;
	/** Bytes of string payload across the whole reply. */
	maxBytes: number;
	/** Bytes of any single string. */
	maxStringBytes: number;
}

export const DEFAULT_CAPS: ReplyCaps = {
	maxElements: 5_000,
	maxBytes: 1_000_000,
	maxStringBytes: 256_000,
};

const utf8 = new TextDecoder("utf-8", { fatal: true });
const lossy = new TextDecoder("utf-8");

function hex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

export interface ConvertedReply {
	reply: Reply;
	truncated: boolean;
}

export function toReply(value: RespValue, caps: ReplyCaps = DEFAULT_CAPS): ConvertedReply {
	const budget = { elements: caps.maxElements, bytes: caps.maxBytes };
	let truncated = false;

	const bulk = (bytes: Uint8Array): Reply => {
		const limit = Math.max(0, Math.min(caps.maxStringBytes, budget.bytes));
		const cut = bytes.length > limit;
		if (cut) truncated = true;
		let shipped = cut ? bytes.subarray(0, limit) : bytes;
		budget.bytes -= shipped.length;
		try {
			const text = utf8.decode(shipped);
			return { t: "bulk", v: text, len: bytes.length, ...(cut && { truncated: true }) };
		} catch {
			// A cut can land inside a multi-byte character; that alone does not make it binary.
			if (cut) {
				for (let back = 1; back <= 3 && back < shipped.length; back++) {
					try {
						const text = utf8.decode(shipped.subarray(0, shipped.length - back));
						return { t: "bulk", v: text, len: bytes.length, truncated: true };
					} catch {}
				}
				shipped = shipped.subarray(0, Math.min(shipped.length, 64_000));
			}
			return {
				t: "bulk",
				v: escapeBytes(shipped, false),
				len: bytes.length,
				binary: true,
				hex: hex(shipped),
				...(cut && { truncated: true }),
			};
		}
	};

	const walk = (node: RespValue): Reply => {
		switch (node.type) {
			case "simple":
				return { t: "simple", v: node.value };
			case "error":
				return { t: "error", v: node.value };
			case "integer":
				return { t: "int", v: node.value };
			case "double":
				return { t: "double", v: node.value };
			case "bignum":
				return { t: "big", v: node.value };
			case "boolean":
				return { t: "bool", v: node.value };
			case "null":
				return { t: "nil" };
			case "bulk":
				return bulk(node.value);
			case "verbatim": {
				const converted = bulk(node.value);
				return {
					t: "verbatim",
					format: node.format,
					v: converted.t === "bulk" ? converted.v : "",
					...(converted.t === "bulk" && converted.truncated && { truncated: true }),
				};
			}
			case "array":
			case "set":
			case "push": {
				const items: Reply[] = [];
				for (const item of node.items) {
					if (budget.elements <= 0) {
						truncated = true;
						return { t: node.type, items, len: node.items.length, truncated: true };
					}
					budget.elements--;
					items.push(walk(item));
				}
				return { t: node.type, items, len: node.items.length };
			}
			case "map": {
				const entries: [Reply, Reply][] = [];
				for (const [k, v] of node.entries) {
					if (budget.elements <= 0) {
						truncated = true;
						return { t: "map", entries, len: node.entries.length, truncated: true };
					}
					budget.elements--;
					entries.push([walk(k), walk(v)]);
				}
				return { t: "map", entries, len: node.entries.length };
			}
		}
	};

	const reply = walk(value);
	return { reply, truncated };
}

/** Text of a scalar reply, for the browser. */
export function replyText(reply: Reply): string | null {
	switch (reply.t) {
		case "simple":
		case "error":
		case "int":
		case "double":
		case "big":
		case "bulk":
		case "verbatim":
			return reply.v;
		case "bool":
			return reply.v ? "true" : "false";
		default:
			return null;
	}
}

/**
 * The reply as redis-cli prints it, for copying and for tests:
 *
 *   1) "a"
 *   2) (integer) 2
 *   3) 1) "nested"
 *
 * Maps print as `1# "key" => value`, sets with `~`, as redis-cli does under RESP3.
 */
export function formatReply(reply: Reply, indent = 0): string {
	switch (reply.t) {
		case "simple":
			return reply.v;
		case "error":
			return `(error) ${reply.v}`;
		case "int":
			return `(integer) ${reply.v}`;
		case "double":
			return `(double) ${reply.v}`;
		case "big":
			return `(big number) ${reply.v}`;
		case "bool":
			return `(${reply.v ? "true" : "false"})`;
		case "nil":
			return "(nil)";
		case "bulk":
			return `"${reply.binary ? reply.v : escapeBytes(new TextEncoder().encode(reply.v))}"${reply.truncated ? " (truncated)" : ""}`;
		case "verbatim":
			return reply.v;
		case "array":
		case "set":
		case "push":
		case "map": {
			const count = reply.t === "map" ? reply.entries.length : reply.items.length;
			if (count === 0) return reply.t === "map" ? "(empty hash)" : "(empty array)";
			const marker = reply.t === "map" ? "#" : reply.t === "set" ? "~" : ")";
			const width = String(count).length;
			const lines: string[] = [];
			for (let i = 0; i < count; i++) {
				const label = `${String(i + 1).padStart(width, " ")}${marker} `;
				const pad = " ".repeat(indent + label.length);
				let body: string;
				if (reply.t === "map") {
					const [k, v] = reply.entries[i];
					const key = formatReply(k, indent + label.length);
					const value = formatReply(v, indent + label.length + key.length + 4);
					body = `${key} => ${value}`;
				} else {
					body = formatReply(reply.items[i], indent + label.length);
				}
				// Continuation lines of nested aggregates align under their parent's content.
				const aligned = body
					.split("\n")
					.map((line, j) => (j === 0 ? line : line.startsWith(pad) ? line : `${pad}${line}`))
					.join("\n");
				lines.push(`${i === 0 ? "" : " ".repeat(indent)}${label}${aligned}`);
			}
			if (reply.truncated) {
				lines.push(`${" ".repeat(indent)}(${reply.len - count} more not shown)`);
			}
			return lines.join("\n");
		}
	}
}

/* ------------------------------------------------------------------ *
 * Errors worth translating
 * ------------------------------------------------------------------ */

export const REDIS_MEMORY_LIMIT_LABEL = "64 MB";

/**
 * `noeviction` turns a full database into an error on the write that does not fit. The
 * engine's wording ("OOM command not allowed when used memory > 'maxmemory'") is accurate
 * but reads like a server fault; this says what it means for the tenant.
 */
export function friendlyRedisError(message: string): string | null {
	if (/^OOM\b/.test(message) || /used memory > 'maxmemory'/.test(message)) {
		return `Database is full: ${REDIS_MEMORY_LIMIT_LABEL} limit reached. Delete keys or set TTLs to free memory, then try again.`;
	}
	if (/^NOPERM\b/.test(message)) {
		return "Your database user is not allowed to run this command. Configuration, ACL and replication commands are managed by blaze.";
	}
	if (/^WRONGTYPE\b/.test(message)) {
		return "The key holds a different type of value than this command works on.";
	}
	return null;
}

export function isOomError(message: string): boolean {
	return /^OOM\b/.test(message) || /used memory > 'maxmemory'/.test(message);
}

/** Decode lossy, for display paths that never round-trip. */
export function lossyText(bytes: Uint8Array): string {
	return lossy.decode(bytes);
}

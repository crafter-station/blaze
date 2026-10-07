import { quoteArg } from "./tokenize";

/**
 * Key names cross the wire between browser and server as strings, but a Redis key is
 * bytes and need not be UTF-8. A key that is valid UTF-8 travels as itself; any other key
 * travels as `\0b64:` followed by its base64. Keys that begin with NUL are always sent in
 * base64, so the prefix can never be mistaken for a real key.
 */

const PREFIX = "\u0000b64:";
const strict = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
	const binary = atob(text);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

export function encodeKeyRef(bytes: Uint8Array): string {
	try {
		const text = strict.decode(bytes);
		if (!text.startsWith("\u0000")) return text;
	} catch {}
	return PREFIX + toBase64(bytes);
}

export function decodeKeyRef(ref: string): Uint8Array {
	if (ref.startsWith(PREFIX)) return fromBase64(ref.slice(PREFIX.length));
	return encoder.encode(ref);
}

export function isBinaryKeyRef(ref: string): boolean {
	return ref.startsWith(PREFIX);
}

/** How a key is shown: itself, or its redis-cli escaped form when it is binary. */
export function keyLabel(ref: string): string {
	if (!isBinaryKeyRef(ref)) return ref;
	return quoteArg(decodeKeyRef(ref)).slice(1, -1);
}

/** The key as a console argument, quoted when needed. */
export function keyArg(ref: string): string {
	return quoteArg(isBinaryKeyRef(ref) ? decodeKeyRef(ref) : ref);
}

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type CoreType = "string" | "list" | "hash" | "set" | "zset" | "stream" | "ReJSON-RL";

export const TYPE_LABEL: Record<string, string> = {
	string: "String",
	list: "List",
	hash: "Hash",
	set: "Set",
	zset: "Sorted set",
	stream: "Stream",
	"ReJSON-RL": "JSON",
	"TSDB-TYPE": "Time series",
	"MBbloom--": "Bloom filter",
	MBbloomCF: "Cuckoo filter",
	"CMSk-TYPE": "Count-min sketch",
	"TopK-TYPE": "Top-K",
	"TDIS-TYPE": "t-digest",
	vectorset: "Vector set",
};

/** Short badge text, fixed width in the key list. */
export const TYPE_BADGE: Record<string, string> = {
	string: "STR",
	list: "LIST",
	hash: "HASH",
	set: "SET",
	zset: "ZSET",
	stream: "STRM",
	"ReJSON-RL": "JSON",
	"TSDB-TYPE": "TS",
	"MBbloom--": "BF",
	MBbloomCF: "CF",
	"CMSk-TYPE": "CMS",
	"TopK-TYPE": "TOPK",
	"TDIS-TYPE": "TDIG",
	vectorset: "VSET",
};

export function typeBadge(type: string): string {
	return TYPE_BADGE[type] ?? type.slice(0, 4).toUpperCase();
}

export function typeLabel(type: string): string {
	return TYPE_LABEL[type] ?? type;
}

/** The type filter values `SCAN ... TYPE` accepts that the browser offers. */
export const FILTERABLE_TYPES = ["string", "list", "hash", "set", "zset", "stream", "ReJSON-RL"];

/** A console command that shows the whole value of a key of this type. */
export function inspectCommand(type: string, ref: string): string {
	const key = keyArg(ref);
	switch (type) {
		case "string":
			return `GET ${key}`;
		case "list":
			return `LRANGE ${key} 0 99`;
		case "hash":
			return `HGETALL ${key}`;
		case "set":
			return `SSCAN ${key} 0 COUNT 100`;
		case "zset":
			return `ZRANGE ${key} 0 99 WITHSCORES`;
		case "stream":
			return `XREVRANGE ${key} + - COUNT 20`;
		case "ReJSON-RL":
			return `JSON.GET ${key} $`;
		case "TSDB-TYPE":
			return `TS.INFO ${key}`;
		case "MBbloom--":
			return `BF.INFO ${key}`;
		case "MBbloomCF":
			return `CF.INFO ${key}`;
		case "CMSk-TYPE":
			return `CMS.INFO ${key}`;
		case "TopK-TYPE":
			return `TOPK.INFO ${key}`;
		case "TDIS-TYPE":
			return `TDIGEST.INFO ${key}`;
		case "vectorset":
			return `VINFO ${key}`;
		default:
			return `TYPE ${key}`;
	}
}

/** Human TTL from milliseconds: `42s`, `3m 20s`, `2h 5m`, `4d 1h`. */
export function formatTtl(ms: number): string {
	if (ms === -1) return "No expiry";
	if (ms === -2) return "Expired";
	if (ms < 1000) return `${ms} ms`;
	const s = Math.floor(ms / 1000);
	const d = Math.floor(s / 86_400);
	const h = Math.floor((s % 86_400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (d > 0) return h ? `${d}d ${h}h` : `${d}d`;
	if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
	if (m > 0) return sec ? `${m}m ${sec}s` : `${m}m`;
	return `${sec}s`;
}

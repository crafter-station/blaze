import type { CommandIndex } from "./commands";
import type { Reply } from "./reply";

/**
 * Shapes shared by the Redis console and key browser on both sides of the server-action
 * boundary. Plain JSON only.
 */

export type Failure = { ok: false; error: string; friendly?: string };

/** One console line, as it ran (or why it did not). */
export interface CommandOutcome {
	line: string;
	ok: boolean;
	reply?: Reply;
	/** Why the line did not produce a reply: a syntax error, a refusal, a lost connection. */
	error?: string;
	kind?: "syntax" | "blocked" | "confirm" | "connection" | "skipped";
	/** Plain-language reading of an engine error (a full database, a refused command). */
	friendly?: string;
	/** Something the console changed, e.g. a blocking timeout it capped. */
	note?: string;
	truncated?: boolean;
	durationMs: number;
}

export interface ConsoleRun {
	results: CommandOutcome[];
	/** A failure before any line ran (not found, suspended, could not connect). */
	error?: string;
}

export interface ServerInfo {
	version: string | null;
	/** Loaded module names as MODULE LIST reports them, e.g. `ReJSON`, `search`. */
	modules: string[];
}

export interface CommandReference {
	index: CommandIndex;
	server: ServerInfo;
	/** True when COMMAND DOCS failed and the index holds names only. */
	namesOnly?: boolean;
}

/** Whether the ReJSON module is loaded, under any of the names it registers. */
export function hasJsonModule(server: ServerInfo | null | undefined): boolean {
	return !!server?.modules.some((m) => /^(ReJSON|json)$/i.test(m));
}

/** Friendly module names for display. */
export const MODULE_LABEL: Record<string, string> = {
	ReJSON: "JSON",
	search: "Search",
	timeseries: "Time series",
	bf: "Probabilistic",
	vectorset: "Vector sets",
};

/* ------------------------------------------------------------------ *
 * Key browser
 * ------------------------------------------------------------------ */

export interface ScanPage {
	keys: { key: string; name: string; type: string; ttl: number }[];
	/** Cursor to continue from; "0" when the keyspace has been fully walked. */
	cursor: string;
	/** Keys examined by SCAN for this page (matching or not). */
	scanned: number;
}

export interface HealthSnapshot {
	usedMemory: number;
	/** The quota the database is held to: `maxmemory`, or blaze's limit if unset. */
	maxMemory: number;
	peakMemory: number | null;
	keys: number;
	hits: number;
	misses: number;
	clients: number | null;
	server: ServerInfo;
	at: number;
}

export interface KeyMeta {
	key: string;
	name: string;
	/** `none` when the key does not exist (any more). */
	type: string;
	/** Milliseconds; -1 no expiry, -2 gone. */
	ttl: number;
	memory: number | null;
	encoding: string | null;
	/** Elements, bytes or entries, depending on the type. */
	length: number | null;
}

/** A bulk value as the browser shows and edits it. */
export interface ValueText {
	/** Text, or the escaped form of binary data. */
	text: string;
	binary?: boolean;
	/** Hex of the (possibly truncated) bytes, only for binary values. */
	hex?: string;
	/** Byte length of the full value. */
	bytes: number;
	truncated?: boolean;
	/** Transport form of the exact bytes (see keys.ts), for edits that must name this value. */
	ref: string;
}

export interface StreamGroup {
	name: string;
	consumers: number;
	pending: number;
	lastDeliveredId: string;
	lag: number | null;
	entriesRead: number | null;
}

export type KeyValue =
	| { kind: "missing" }
	| { kind: "string"; value: ValueText }
	| { kind: "list"; items: { index: number; value: ValueText }[]; offset: number; total: number }
	| {
			kind: "hash";
			entries: { field: ValueText; value: ValueText }[];
			cursor: string;
			total: number;
	  }
	| { kind: "set"; members: ValueText[]; cursor: string; total: number }
	| {
			kind: "zset";
			members: { member: ValueText; score: string; rank: number }[];
			offset: number;
			total: number;
	  }
	| {
			kind: "stream";
			entries: { id: string; fields: [string, string][] }[];
			groups: StreamGroup[];
			length: number;
			firstId: string | null;
			lastId: string | null;
			/** Id to page older entries from, when there are more. */
			before: string | null;
	  }
	| { kind: "json"; json: string | null; bytes: number; truncated?: boolean; unavailable?: string }
	| { kind: "other"; type: string; command: string };

export interface KeyDetails {
	meta: KeyMeta;
	value: KeyValue;
}

/** How far into a value to read. */
export interface ValuePage {
	/** Lists and sorted sets: element offset. */
	offset?: number;
	/** Hashes and sets: SCAN cursor. */
	cursor?: string;
	/** Streams: read entries with ids strictly below this one. */
	before?: string;
}

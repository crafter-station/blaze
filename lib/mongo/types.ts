import type { Confirmation } from "./classify";
import type { EJsonValue } from "./literal";
import type { CollectionShape } from "./schema";

/**
 * Shapes shared by the Mongo Browser and Shell on both sides of the server-action
 * boundary. Plain JSON only; documents travel as display Extended JSON (lib/mongo/ejson.ts).
 */

export type Failure = { ok: false; error: string; friendly?: string; position?: number };

export interface CollectionSummary {
	name: string;
	type: "collection" | "view" | "timeseries";
	/** Estimated from collection metadata; exact counts are a separate, slower call. */
	count: number | null;
	/** Bytes on disk (compressed), what the storage quota counts. */
	storageSize: number | null;
	/** Uncompressed size of the documents. */
	dataSize: number | null;
	indexCount: number | null;
	totalIndexSize: number | null;
}

export interface DatabaseOverview {
	collections: CollectionSummary[];
	/** From dbStats: what the quota sweep measures. */
	storageSize: number;
	dataSize: number;
	objects: number;
	indexes: number;
	indexSize: number;
}

export interface FindRequest {
	collection: string;
	filter: string;
	projection: string;
	sort: string;
	skip: number;
	limit: number;
}

export interface FindPage {
	docs: EJsonValue[];
	/** True when another page exists after this one. */
	hasMore: boolean;
	/** True when documents were held back to stay under the response size budget. */
	clipped: boolean;
	durationMs: number;
}

export interface IndexInfo {
	name: string;
	key: EJsonValue;
	unique: boolean;
	sparse: boolean;
	/** TTL in seconds, for TTL indexes. */
	expireAfterSeconds: number | null;
	partialFilterExpression: EJsonValue | null;
	/** Other options the server reports (collation, weights, 2dsphere version, …). */
	extra: Record<string, EJsonValue>;
	size: number | null;
}

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

export type ShellResult =
	| { kind: "documents"; docs: EJsonValue[]; truncated: boolean; clipped: boolean }
	| { kind: "value"; value: EJsonValue }
	| { kind: "count"; value: number }
	| { kind: "text"; text: string };

export interface ShellOutcome {
	source: string;
	ok: boolean;
	/** `orders.find`, `ping`, … */
	label?: string;
	result?: ShellResult;
	error?: string;
	/** Where in `source` a parse error is, when that is what went wrong. */
	position?: number;
	kind?: "syntax" | "blocked" | "confirm" | "server" | "connection";
	/** For `kind: "confirm"`: what the dialog should say and whether a name must be typed. */
	confirm?: Confirmation;
	friendly?: string;
	note?: string;
	durationMs: number;
}

export interface ShellContext {
	collections: string[];
	shapes: CollectionShape[];
}

import "server-only";
import { LIMITS } from "@/lib/limits";
import type { OwnedRedis } from "./access";
import type { RedisConnection } from "./client";
import { decodeKeyRef, encodeKeyRef, inspectCommand, keyLabel } from "./keys";
import { serverInfo } from "./reference";
import { asList, asNumber, asPairs, asText, type RespValue } from "./resp";
import { withTenantRedis } from "./tenant";
import type {
	HealthSnapshot,
	KeyDetails,
	KeyMeta,
	KeyValue,
	ScanPage,
	StreamGroup,
	ValuePage,
} from "./types";
import { valueText } from "./value";

/**
 * Reads behind the key browser, all as the tenant's `default` user.
 *
 * The keyspace is walked with SCAN and never KEYS: KEYS blocks the server for the whole
 * walk, which on a tenant's only Redis means every request of theirs waits behind the
 * browser. SCAN returns a bounded slice per call; a page here is a few SCAN calls, capped
 * in both calls and time, so a sparse pattern over a large keyspace still answers quickly
 * and simply offers to continue.
 */

/** Keys a page aims for before returning. */
export const PAGE_TARGET = 300;
const SCAN_COUNT = 1000;
const MAX_SCAN_CALLS = 25;
const SCAN_BUDGET_MS = 1_500;

/** Elements per page of a list, hash, set or sorted set; entries per page of a stream. */
export const VALUE_PAGE = 200;
export const STREAM_PAGE = 100;

const bytesOf = (value: RespValue | undefined): Uint8Array =>
	value?.type === "bulk" || value?.type === "verbatim"
		? value.value
		: new TextEncoder().encode(asText(value) ?? "");

export function browse<T>(
	record: OwnedRedis,
	fn: (conn: RedisConnection) => Promise<T>,
): Promise<T> {
	return withTenantRedis(record, fn, { clientName: "blaze-browser" });
}

/* ------------------------------------------------------------------ *
 * Keyspace
 * ------------------------------------------------------------------ */

export async function scanKeys(
	conn: RedisConnection,
	options: { cursor: string; match: string; type?: string },
): Promise<ScanPage> {
	const started = Date.now();
	let cursor = options.cursor || "0";
	let scanned = 0;
	const found: Uint8Array[] = [];
	for (let call = 0; call < MAX_SCAN_CALLS; call++) {
		const args = ["SCAN", cursor, "MATCH", options.match || "*", "COUNT", String(SCAN_COUNT)];
		if (options.type) args.push("TYPE", options.type);
		const reply = await conn.callOk(args);
		const [next, keys] = asList(reply);
		cursor = asText(next) ?? "0";
		const page = asList(keys);
		scanned += SCAN_COUNT;
		for (const key of page) found.push(bytesOf(key));
		if (cursor === "0" || found.length >= PAGE_TARGET || Date.now() - started > SCAN_BUDGET_MS)
			break;
	}

	// One round trip for every key's type and TTL.
	const meta = found.length
		? await conn.pipeline(
				found.flatMap((key) => [
					["TYPE", key],
					["PTTL", key],
				]),
			)
		: [];
	const keys = found.map((bytes, i) => {
		const ref = encodeKeyRef(bytes);
		return {
			key: ref,
			name: keyLabel(ref),
			type: options.type ?? asText(meta[i * 2]) ?? "none",
			ttl: asNumber(meta[i * 2 + 1]),
		};
	});
	return { keys, cursor, scanned };
}

export async function memoryUsage(
	conn: RedisConnection,
	refs: string[],
): Promise<(number | null)[]> {
	if (refs.length === 0) return [];
	const replies = await conn.pipeline(
		refs.map((ref) => ["MEMORY", "USAGE", decodeKeyRef(ref), "SAMPLES", "5"]),
	);
	return replies.map((reply) => (reply.type === "integer" ? Number(reply.value) : null));
}

/* ------------------------------------------------------------------ *
 * Health
 * ------------------------------------------------------------------ */

function infoField(info: string, name: string): number | null {
	const match = new RegExp(`^${name}:([0-9.]+)`, "m").exec(info);
	return match ? Number(match[1]) : null;
}

export async function health(conn: RedisConnection): Promise<HealthSnapshot> {
	const [info, size] = await conn.pipeline([["INFO", "memory", "stats", "clients"], ["DBSIZE"]]);
	const server = await serverInfo(conn);
	const text = asText(info) ?? "";
	const maxmemory = infoField(text, "maxmemory") ?? 0;
	return {
		usedMemory: infoField(text, "used_memory") ?? 0,
		// `maxmemory 0` means unlimited; a tenant is still held to blaze's quota.
		maxMemory: maxmemory > 0 ? maxmemory : LIMITS.REDIS_MEMORY_BYTES,
		peakMemory: infoField(text, "used_memory_peak"),
		keys: asNumber(size),
		hits: infoField(text, "keyspace_hits") ?? 0,
		misses: infoField(text, "keyspace_misses") ?? 0,
		// Minus this connection, which is the browser's and not the tenant's.
		clients: Math.max(0, (infoField(text, "connected_clients") ?? 1) - 1),
		server,
		at: Date.now(),
	};
}

/* ------------------------------------------------------------------ *
 * One key
 * ------------------------------------------------------------------ */

const LENGTH_COMMAND: Record<string, string> = {
	string: "STRLEN",
	list: "LLEN",
	hash: "HLEN",
	set: "SCARD",
	zset: "ZCARD",
	stream: "XLEN",
};

export async function keyMeta(conn: RedisConnection, ref: string): Promise<KeyMeta> {
	const key = decodeKeyRef(ref);
	const [type, ttl, memory, encoding] = await conn.pipeline([
		["TYPE", key],
		["PTTL", key],
		["MEMORY", "USAGE", key, "SAMPLES", "5"],
		["OBJECT", "ENCODING", key],
	]);
	const typeName = asText(type) ?? "none";
	let length: number | null = null;
	const lengthCommand = LENGTH_COMMAND[typeName];
	if (lengthCommand) length = asNumber(await conn.call([lengthCommand, key]));
	else if (typeName === "ReJSON-RL") {
		const size = await conn.call(["JSON.DEBUG", "MEMORY", key]);
		length = size.type === "integer" ? Number(size.value) : null;
	}
	return {
		key: ref,
		name: keyLabel(ref),
		type: typeName,
		ttl: asNumber(ttl),
		memory: memory.type === "integer" ? Number(memory.value) : null,
		encoding: encoding.type === "error" ? null : asText(encoding),
		length: Number.isFinite(length) ? length : null,
	};
}

export async function keyValue(
	conn: RedisConnection,
	meta: KeyMeta,
	page: ValuePage = {},
	jsonAvailable = true,
): Promise<KeyValue> {
	const key = decodeKeyRef(meta.key);
	switch (meta.type) {
		case "none":
			return { kind: "missing" };
		case "string": {
			// GETRANGE bounds what is read, however large the value is.
			const value = await conn.callOk(["GETRANGE", key, "0", String(256_000)]);
			const shown = valueText(bytesOf(value), 256_000);
			return {
				kind: "string",
				value: {
					...shown,
					bytes: meta.length ?? shown.bytes,
					truncated: (meta.length ?? 0) > 256_000 || shown.truncated,
				},
			};
		}
		case "list": {
			const offset = Math.max(0, page.offset ?? 0);
			const items = asList(
				await conn.callOk(["LRANGE", key, String(offset), String(offset + VALUE_PAGE - 1)]),
			);
			return {
				kind: "list",
				offset,
				total: meta.length ?? items.length,
				items: items.map((item, i) => ({
					index: offset + i,
					value: valueText(bytesOf(item), 16_000),
				})),
			};
		}
		case "hash": {
			const reply = asList(
				await conn.callOk(["HSCAN", key, page.cursor ?? "0", "COUNT", String(VALUE_PAGE)]),
			);
			const flat = asList(reply[1]);
			const entries: {
				field: ReturnType<typeof valueText>;
				value: ReturnType<typeof valueText>;
			}[] = [];
			for (let i = 0; i + 1 < flat.length; i += 2) {
				entries.push({
					field: valueText(bytesOf(flat[i]), 4_000),
					value: valueText(bytesOf(flat[i + 1]), 16_000),
				});
			}
			return {
				kind: "hash",
				entries,
				cursor: asText(reply[0]) ?? "0",
				total: meta.length ?? entries.length,
			};
		}
		case "set": {
			const reply = asList(
				await conn.callOk(["SSCAN", key, page.cursor ?? "0", "COUNT", String(VALUE_PAGE)]),
			);
			return {
				kind: "set",
				members: asList(reply[1]).map((m) => valueText(bytesOf(m), 16_000)),
				cursor: asText(reply[0]) ?? "0",
				total: meta.length ?? 0,
			};
		}
		case "zset": {
			const offset = Math.max(0, page.offset ?? 0);
			const reply = await conn.callOk([
				"ZRANGE",
				key,
				String(offset),
				String(offset + VALUE_PAGE - 1),
				"WITHSCORES",
			]);
			// RESP3 answers [[member, score], ...]; RESP2 a flat list.
			const items = asList(reply);
			const members: { member: ReturnType<typeof valueText>; score: string; rank: number }[] = [];
			if (items[0] && (items[0].type === "array" || items[0].type === "set")) {
				items.forEach((pair, i) => {
					const [m, s] = asList(pair);
					members.push({
						member: valueText(bytesOf(m), 16_000),
						score: asText(s) ?? "",
						rank: offset + i,
					});
				});
			} else {
				for (let i = 0; i + 1 < items.length; i += 2) {
					members.push({
						member: valueText(bytesOf(items[i]), 16_000),
						score: asText(items[i + 1]) ?? "",
						rank: offset + i / 2,
					});
				}
			}
			return { kind: "zset", members, offset, total: meta.length ?? members.length };
		}
		case "stream":
			return streamValue(conn, key, meta, page);
		case "ReJSON-RL": {
			if (!jsonAvailable) {
				return {
					kind: "json",
					json: null,
					bytes: 0,
					unavailable:
						"The JSON module is not loaded on this server, so this value can only be inspected raw.",
				};
			}
			const reply = await conn.call(["JSON.GET", key]);
			if (reply.type === "error") {
				return { kind: "json", json: null, bytes: 0, unavailable: reply.value };
			}
			const bytes = bytesOf(reply);
			const limit = 512_000;
			return {
				kind: "json",
				json: bytes.length > limit ? null : new TextDecoder().decode(bytes),
				bytes: bytes.length,
				...(bytes.length > limit && { truncated: true }),
			};
		}
		default:
			return { kind: "other", type: meta.type, command: inspectCommand(meta.type, meta.key) };
	}
}

async function streamValue(
	conn: RedisConnection,
	key: Uint8Array,
	meta: KeyMeta,
	page: ValuePage,
): Promise<KeyValue> {
	const end = page.before ? `(${page.before}` : "+";
	const [range, groupsReply, first, last] = await conn.pipeline([
		["XREVRANGE", key, end, "-", "COUNT", String(STREAM_PAGE + 1)],
		["XINFO", "GROUPS", key],
		["XRANGE", key, "-", "+", "COUNT", "1"],
		["XREVRANGE", key, "+", "-", "COUNT", "1"],
	]);
	const raw = asList(range);
	const more = raw.length > STREAM_PAGE;
	const entries = raw.slice(0, STREAM_PAGE).map((entry) => {
		const [id, fields] = asList(entry);
		const flat = asList(fields);
		const pairs: [string, string][] = [];
		for (let i = 0; i + 1 < flat.length; i += 2) {
			pairs.push([
				valueText(bytesOf(flat[i]), 2_000).text,
				valueText(bytesOf(flat[i + 1]), 4_000).text,
			]);
		}
		return { id: asText(id) ?? "", fields: pairs };
	});
	const groups: StreamGroup[] =
		groupsReply.type === "error"
			? []
			: asList(groupsReply).map((group) => {
					const fields = new Map(asPairs(group));
					const num = (name: string) => {
						const value = fields.get(name);
						return value && value.type !== "null" ? asNumber(value) : null;
					};
					return {
						name: asText(fields.get("name")) ?? "",
						consumers: num("consumers") ?? 0,
						pending: num("pending") ?? 0,
						lastDeliveredId: asText(fields.get("last-delivered-id")) ?? "",
						lag: num("lag"),
						entriesRead: num("entries-read"),
					};
				});
	const idOf = (reply: RespValue) => asText(asList(asList(reply)[0])[0]) ?? null;
	return {
		kind: "stream",
		entries,
		groups,
		length: meta.length ?? entries.length,
		firstId: idOf(first),
		lastId: idOf(last),
		before: more ? (entries.at(-1)?.id ?? null) : null,
	};
}

export async function keyDetails(
	conn: RedisConnection,
	ref: string,
	page: ValuePage = {},
	jsonAvailable = true,
): Promise<KeyDetails> {
	const meta = await keyMeta(conn, ref);
	return { meta, value: await keyValue(conn, meta, page, jsonAvailable) };
}

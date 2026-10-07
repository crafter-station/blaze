import "server-only";
import { z } from "zod";
import type { RedisConnection } from "./client";
import { RedisCommandError } from "./client";
import { decodeKeyRef, encodeKeyRef, keyLabel } from "./keys";
import { asList, asNumber, asText, type RespValue } from "./resp";

/**
 * Writes behind the key browser, as the tenant's `default` user.
 *
 * Every operation names exactly what it changes, by the bytes it read: an element is
 * removed by its value as it was shown, a field renamed from the name it had. Where the
 * value could have changed between reading and writing (removing a list element by
 * index), the write is guarded with WATCH, and a lost race is reported rather than
 * deleting whatever moved into that slot.
 */

/** Strings arrive as text; refs (see keys.ts) carry exact bytes for things being named. */
const ref = z.string().max(200_000);
const text = z.string().max(2_000_000);
const score = z
	.string()
	.trim()
	.regex(
		/^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|[+-]?inf)$/i,
		"Scores are numbers (or inf / -inf).",
	);
const streamId = z
	.string()
	.regex(/^(\*|\d+(-(\d+|\*))?)$/, "Stream ids look like 1712345678901-0, or * to let Redis pick.");
const fieldPairs = z
	.array(z.tuple([text, text]))
	.min(1)
	.max(1000);

export const editOp = z.discriminatedUnion("op", [
	z.object({ op: z.literal("string.set"), key: ref, value: text }),
	z.object({
		op: z.literal("list.set"),
		key: ref,
		index: z.number().int(),
		expect: ref,
		value: text,
	}),
	z.object({ op: z.literal("list.push"), key: ref, value: text, end: z.enum(["head", "tail"]) }),
	z.object({ op: z.literal("list.remove"), key: ref, index: z.number().int(), expect: ref }),
	z.object({ op: z.literal("hash.set"), key: ref, field: text, value: text, from: ref.optional() }),
	z.object({ op: z.literal("hash.delete"), key: ref, field: ref }),
	z.object({ op: z.literal("set.add"), key: ref, member: text }),
	z.object({ op: z.literal("set.replace"), key: ref, member: ref, next: text }),
	z.object({ op: z.literal("set.remove"), key: ref, member: ref }),
	z.object({ op: z.literal("zset.add"), key: ref, member: text, score }),
	z.object({ op: z.literal("zset.replace"), key: ref, member: ref, next: text, score }),
	z.object({ op: z.literal("zset.remove"), key: ref, member: ref }),
	z.object({ op: z.literal("stream.add"), key: ref, id: streamId, fields: fieldPairs }),
	z.object({ op: z.literal("stream.delete"), key: ref, id: z.string().regex(/^\d+-\d+$/) }),
	z.object({ op: z.literal("json.set"), key: ref, path: z.string().min(1).max(1000), json: text }),
	z.object({ op: z.literal("json.delete"), key: ref, path: z.string().min(1).max(1000) }),
	z.object({
		op: z.literal("ttl.set"),
		key: ref,
		seconds: z
			.number()
			.int()
			.min(1)
			.max(10 * 365 * 86_400),
	}),
	z.object({ op: z.literal("ttl.persist"), key: ref }),
	z.object({
		op: z.literal("rename"),
		key: ref,
		name: z.string().min(1).max(512_000),
		overwrite: z.boolean().optional(),
	}),
	z.object({ op: z.literal("delete"), key: ref }),
	z.object({
		op: z.literal("create"),
		key: z.string().min(1).max(512_000),
		ttl: z
			.number()
			.int()
			.min(1)
			.max(10 * 365 * 86_400)
			.optional(),
		value: z.discriminatedUnion("type", [
			z.object({ type: z.literal("string"), value: text }),
			z.object({ type: z.literal("list"), items: z.array(text).min(1).max(10_000) }),
			z.object({ type: z.literal("hash"), fields: fieldPairs }),
			z.object({ type: z.literal("set"), members: z.array(text).min(1).max(10_000) }),
			z.object({
				type: z.literal("zset"),
				members: z
					.array(z.tuple([score, text]))
					.min(1)
					.max(10_000),
			}),
			z.object({ type: z.literal("stream"), fields: fieldPairs }),
			z.object({ type: z.literal("json"), json: text }),
		]),
	}),
]);

export type EditOp = z.infer<typeof editOp>;

export interface EditResult {
	/** What happened, for a toast. */
	message: string;
	/** The key the browser should show afterwards (a rename or create moves it). */
	key: string | null;
	/** Type of a created key, for the list. */
	type?: string;
}

export class EditConflict extends Error {}

const enc = new TextEncoder();
const bytes = (value: string) => enc.encode(value);
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
	a.length === b.length && a.every((x, i) => x === b[i]);

async function exists(conn: RedisConnection, key: Uint8Array): Promise<boolean> {
	return asNumber(await conn.callOk(["EXISTS", key])) === 1;
}

async function requireType(conn: RedisConnection, key: Uint8Array, type: string) {
	const actual = asText(await conn.callOk(["TYPE", key]));
	if (actual === "none")
		throw new EditConflict("The key no longer exists. It may have expired or been deleted.");
	if (actual !== type)
		throw new EditConflict(`The key now holds a ${actual}, not a ${type}. Reload it.`);
}

/** MULTI ... EXEC on this connection; an error inside the transaction is thrown. */
async function transaction(
	conn: RedisConnection,
	commands: (string | Uint8Array)[][],
): Promise<RespValue[] | null> {
	await conn.callOk(["MULTI"]);
	for (const command of commands) await conn.callOk(command);
	const result = await conn.callOk(["EXEC"]);
	if (result.type === "null") return null;
	const replies = asList(result);
	const failed = replies.find((r) => r.type === "error");
	if (failed && failed.type === "error") throw new RedisCommandError(failed.value);
	return replies;
}

export async function applyEdit(conn: RedisConnection, op: EditOp): Promise<EditResult> {
	if (op.op === "create") return create(conn, op);
	const key = decodeKeyRef(op.key);
	const name = keyLabel(op.key);
	const done = (message: string, next: string | null = op.key): EditResult => ({
		message,
		key: next,
	});

	switch (op.op) {
		case "string.set": {
			await requireType(conn, key, "string");
			// XX: never resurrect a key deleted in the meantime; KEEPTTL: an edit is not a reset.
			const reply = await conn.callOk(["SET", key, bytes(op.value), "XX", "KEEPTTL"]);
			if (reply.type === "null") throw new EditConflict("The key no longer exists.");
			return done("Saved");
		}
		case "list.set":
		case "list.remove": {
			await conn.callOk(["WATCH", key]);
			const current = await conn.callOk(["LINDEX", key, String(op.index)]);
			if (current.type !== "bulk" || !sameBytes(current.value, decodeKeyRef(op.expect))) {
				await conn.callOk(["UNWATCH"]);
				throw new EditConflict(
					"That element changed since it was loaded. Reload the list and try again.",
				);
			}
			let result: RespValue[] | null;
			if (op.op === "list.set") {
				result = await transaction(conn, [["LSET", key, String(op.index), bytes(op.value)]]);
			} else {
				// Lists have no remove-by-index: mark the slot with a value nothing else holds,
				// then remove that value once.
				const tombstone = `__blaze_removed_${crypto.randomUUID()}`;
				result = await transaction(conn, [
					["LSET", key, String(op.index), tombstone],
					["LREM", key, "1", tombstone],
				]);
			}
			if (!result)
				throw new EditConflict("The list changed while saving. Reload it and try again.");
			return done(op.op === "list.set" ? "Element saved" : "Element removed");
		}
		case "list.push":
			await requireType(conn, key, "list");
			await conn.callOk([op.end === "head" ? "LPUSH" : "RPUSH", key, bytes(op.value)]);
			return done(op.end === "head" ? "Added at the head" : "Added at the tail");
		case "hash.set": {
			await requireType(conn, key, "hash");
			const field = bytes(op.field);
			const from = op.from ? decodeKeyRef(op.from) : null;
			if (from && !sameBytes(from, field)) {
				if (asNumber(await conn.callOk(["HEXISTS", key, field])) === 1) {
					throw new EditConflict(`The hash already has a field named ${op.field}.`);
				}
				await transaction(conn, [
					["HSET", key, field, bytes(op.value)],
					["HDEL", key, from],
				]);
				return done("Field renamed and saved");
			}
			await conn.callOk(["HSET", key, field, bytes(op.value)]);
			return done(from ? "Field saved" : "Field added");
		}
		case "hash.delete": {
			const removed = asNumber(await conn.callOk(["HDEL", key, decodeKeyRef(op.field)]));
			return done(removed ? "Field deleted" : "The field was already gone");
		}
		case "set.add": {
			await requireType(conn, key, "set");
			const added = asNumber(await conn.callOk(["SADD", key, bytes(op.member)]));
			return done(added ? "Member added" : "Already a member");
		}
		case "set.replace": {
			await requireType(conn, key, "set");
			await transaction(conn, [
				["SREM", key, decodeKeyRef(op.member)],
				["SADD", key, bytes(op.next)],
			]);
			return done("Member saved");
		}
		case "set.remove":
			await conn.callOk(["SREM", key, decodeKeyRef(op.member)]);
			return done("Member removed");
		case "zset.add":
			await requireType(conn, key, "zset");
			await conn.callOk(["ZADD", key, op.score, bytes(op.member)]);
			return done("Member saved");
		case "zset.replace": {
			await requireType(conn, key, "zset");
			const from = decodeKeyRef(op.member);
			const to = bytes(op.next);
			if (sameBytes(from, to)) {
				await conn.callOk(["ZADD", key, "XX", op.score, to]);
			} else {
				await transaction(conn, [
					["ZREM", key, from],
					["ZADD", key, op.score, to],
				]);
			}
			return done("Member saved");
		}
		case "zset.remove":
			await conn.callOk(["ZREM", key, decodeKeyRef(op.member)]);
			return done("Member removed");
		case "stream.add": {
			await requireType(conn, key, "stream");
			const id = await conn.callOk(["XADD", key, op.id, ...op.fields.flat().map(bytes)]);
			return done(`Entry ${asText(id)} added`);
		}
		case "stream.delete":
			await conn.callOk(["XDEL", key, op.id]);
			return done(`Entry ${op.id} deleted`);
		case "json.set":
			await requireType(conn, key, "ReJSON-RL");
			JSON.parse(op.json);
			await conn.callOk(["JSON.SET", key, op.path, op.json]);
			return done("Saved");
		case "json.delete":
			await conn.callOk(["JSON.DEL", key, op.path]);
			return done(`Removed ${op.path}`);
		case "ttl.set": {
			const set = asNumber(await conn.callOk(["EXPIRE", key, String(op.seconds)]));
			if (!set) throw new EditConflict("The key no longer exists.");
			return done("Expiry set");
		}
		case "ttl.persist":
			await conn.callOk(["PERSIST", key]);
			return done("Expiry removed");
		case "rename": {
			const target = bytes(op.name);
			if (sameBytes(target, key)) return done("Name unchanged");
			if (op.overwrite) await conn.callOk(["RENAME", key, target]);
			else if (asNumber(await conn.callOk(["RENAMENX", key, target])) === 0) {
				throw new EditConflict(`A key named ${op.name} already exists.`);
			}
			return done(`Renamed to ${op.name}`, encodeKeyRef(target));
		}
		case "delete": {
			const removed = asNumber(await conn.callOk(["UNLINK", key]));
			return done(removed ? `Deleted ${name}` : "The key was already gone", null);
		}
	}
}

async function create(
	conn: RedisConnection,
	op: Extract<EditOp, { op: "create" }>,
): Promise<EditResult> {
	const key = bytes(op.key);
	if (await exists(conn, key)) throw new EditConflict(`A key named ${op.key} already exists.`);
	const v = op.value;
	const commands: (string | Uint8Array)[][] = [];
	let type: string = v.type;
	switch (v.type) {
		case "string":
			commands.push(["SET", key, bytes(v.value), "NX"]);
			break;
		case "list":
			commands.push(["RPUSH", key, ...v.items.map(bytes)]);
			break;
		case "hash":
			commands.push(["HSET", key, ...v.fields.flat().map(bytes)]);
			break;
		case "set":
			commands.push(["SADD", key, ...v.members.map(bytes)]);
			break;
		case "zset":
			commands.push(["ZADD", key, ...v.members.flatMap(([s, m]) => [s, bytes(m)])]);
			break;
		case "stream":
			commands.push(["XADD", key, "*", ...v.fields.flat().map(bytes)]);
			break;
		case "json":
			JSON.parse(v.json);
			commands.push(["JSON.SET", key, "$", v.json, "NX"]);
			type = "ReJSON-RL";
			break;
	}
	if (op.ttl) commands.push(["EXPIRE", key, String(op.ttl)]);
	await transaction(conn, commands);
	return { message: `Created ${op.key}`, key: encodeKeyRef(key), type };
}

/* ------------------------------------------------------------------ *
 * Bulk
 * ------------------------------------------------------------------ */

/** Keys looked at by a preview before it settles for "at least". */
const PREVIEW_LIMIT = 200_000;
const PREVIEW_BUDGET_MS = 5_000;
const DELETE_BUDGET_MS = 20_000;
const UNLINK_BATCH = 500;

export async function previewPattern(
	conn: RedisConnection,
	pattern: string,
): Promise<{ count: number; sample: string[]; complete: boolean }> {
	const started = Date.now();
	let cursor = "0";
	let count = 0;
	const sample: string[] = [];
	do {
		const [next, keys] = asList(
			await conn.callOk(["SCAN", cursor, "MATCH", pattern, "COUNT", "1000"]),
		);
		cursor = asText(next) ?? "0";
		for (const key of asList(keys)) {
			count++;
			if (sample.length < 12 && key.type === "bulk") sample.push(keyLabel(encodeKeyRef(key.value)));
		}
	} while (cursor !== "0" && count < PREVIEW_LIMIT && Date.now() - started < PREVIEW_BUDGET_MS);
	return { count, sample, complete: cursor === "0" };
}

/**
 * SCAN + UNLINK in batches. UNLINK frees memory in the background, so a large delete does
 * not stall the tenant's server the way DEL would. Time-boxed: a very large match deletes
 * what it can and says to run it again.
 */
export async function deletePattern(
	conn: RedisConnection,
	pattern: string,
): Promise<{ deleted: number; complete: boolean }> {
	const started = Date.now();
	let cursor = "0";
	let deleted = 0;
	let batch: Uint8Array[] = [];
	const flush = async () => {
		if (batch.length === 0) return;
		deleted += asNumber(await conn.callOk(["UNLINK", ...batch]));
		batch = [];
	};
	do {
		const [next, keys] = asList(
			await conn.callOk(["SCAN", cursor, "MATCH", pattern, "COUNT", "1000"]),
		);
		cursor = asText(next) ?? "0";
		for (const key of asList(keys)) {
			if (key.type === "bulk") batch.push(key.value);
			if (batch.length >= UNLINK_BATCH) await flush();
		}
	} while (cursor !== "0" && Date.now() - started < DELETE_BUDGET_MS);
	await flush();
	return { deleted, complete: cursor === "0" };
}

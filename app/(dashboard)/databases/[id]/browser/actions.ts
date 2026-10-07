"use server";

import { z } from "zod";
import { describeRedisError, ownedRedisDatabase } from "@/lib/redis/access";
import { browse, health, keyDetails, memoryUsage, scanKeys } from "@/lib/redis/browse";
import {
	applyEdit,
	deletePattern,
	EditConflict,
	type EditResult,
	editOp,
	previewPattern,
} from "@/lib/redis/edit";
import { FILTERABLE_TYPES } from "@/lib/redis/keys";
import type { Failure, HealthSnapshot, KeyDetails, ScanPage, ValuePage } from "@/lib/redis/types";

/**
 * Server actions behind the key browser. Same model as the console's: ownership first,
 * then a short-lived connection as the tenant's `default` user. Nothing here reads a
 * value the browser did not ask for, and nothing walks the keyspace with KEYS.
 */

type Ok<T> = { ok: true } & T;

function cleanPattern(raw: unknown): string {
	const pattern = String(raw ?? "").slice(0, 512);
	return pattern || "*";
}

export async function scanKeysAction(
	databaseId: string,
	input: { cursor?: string; match?: string; type?: string },
): Promise<Ok<ScanPage> | Failure> {
	const owned = await ownedRedisDatabase(databaseId);
	if ("error" in owned) return owned;
	const cursor = /^\d+$/.test(String(input?.cursor ?? "0")) ? String(input?.cursor ?? "0") : "0";
	const type = input?.type && FILTERABLE_TYPES.includes(input.type) ? input.type : undefined;
	try {
		const page = await browse(owned.record, (conn) =>
			scanKeys(conn, { cursor, match: cleanPattern(input?.match), type }),
		);
		return { ok: true, ...page };
	} catch (error) {
		return describeRedisError(error, "Could not list keys");
	}
}

export async function memoryUsageAction(
	databaseId: string,
	keys: string[],
): Promise<Ok<{ memory: (number | null)[] }> | Failure> {
	const owned = await ownedRedisDatabase(databaseId);
	if ("error" in owned) return owned;
	const list = (Array.isArray(keys) ? keys : []).slice(0, 200).map(String);
	try {
		return { ok: true, memory: await browse(owned.record, (conn) => memoryUsage(conn, list)) };
	} catch (error) {
		return describeRedisError(error, "Could not read memory usage");
	}
}

export async function healthAction(
	databaseId: string,
): Promise<Ok<{ health: HealthSnapshot }> | Failure> {
	const owned = await ownedRedisDatabase(databaseId);
	if ("error" in owned) return owned;
	try {
		return { ok: true, health: await browse(owned.record, health) };
	} catch (error) {
		return describeRedisError(error, "Could not read the server's health");
	}
}

export async function keyDetailsAction(
	databaseId: string,
	key: string,
	page: ValuePage = {},
): Promise<Ok<{ details: KeyDetails }> | Failure> {
	const owned = await ownedRedisDatabase(databaseId);
	if ("error" in owned) return owned;
	const safePage: ValuePage = {
		offset: Number.isInteger(page?.offset) ? Math.max(0, Number(page.offset)) : undefined,
		cursor: /^\d+$/.test(String(page?.cursor ?? "")) ? String(page.cursor) : undefined,
		before: /^\d+-\d+$/.test(String(page?.before ?? "")) ? String(page.before) : undefined,
	};
	try {
		const details = await browse(owned.record, (conn) => keyDetails(conn, String(key), safePage));
		return { ok: true, details };
	} catch (error) {
		return describeRedisError(error, "Could not read the key");
	}
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

function editFailure(error: unknown, fallback: string): Failure {
	if (error instanceof EditConflict) return { ok: false, error: error.message };
	if (error instanceof SyntaxError) return { ok: false, error: `Not valid JSON: ${error.message}` };
	return describeRedisError(error, fallback);
}

export async function editKeyAction(
	databaseId: string,
	input: unknown,
): Promise<Ok<EditResult> | Failure> {
	const owned = await ownedRedisDatabase(databaseId);
	if ("error" in owned) return owned;
	const parsed = editOp.safeParse(input);
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid change" };
	}
	try {
		const result = await browse(owned.record, (conn) => applyEdit(conn, parsed.data));
		return { ok: true, ...result };
	} catch (error) {
		return editFailure(error, "Could not save the change");
	}
}

const patternSchema = z.string().trim().min(1).max(512);

export async function previewPatternAction(
	databaseId: string,
	pattern: string,
): Promise<Ok<{ count: number; sample: string[]; complete: boolean }> | Failure> {
	const owned = await ownedRedisDatabase(databaseId);
	if ("error" in owned) return owned;
	const parsed = patternSchema.safeParse(pattern);
	if (!parsed.success) return { ok: false, error: "Enter a pattern, such as cache:*" };
	try {
		return {
			ok: true,
			...(await browse(owned.record, (conn) => previewPattern(conn, parsed.data))),
		};
	} catch (error) {
		return describeRedisError(error, "Could not count matching keys");
	}
}

/**
 * Delete every key matching a pattern. The browser only offers this after a preview of
 * the same pattern; `confirmed` repeats the pattern the user saw counted, so a stale
 * dialog cannot delete a different set.
 */
export async function deletePatternAction(
	databaseId: string,
	pattern: string,
	confirmed: string,
): Promise<Ok<{ deleted: number; complete: boolean }> | Failure> {
	const owned = await ownedRedisDatabase(databaseId);
	if ("error" in owned) return owned;
	const parsed = patternSchema.safeParse(pattern);
	if (!parsed.success || confirmed !== parsed.data) {
		return { ok: false, error: "Preview the pattern before deleting." };
	}
	try {
		return {
			ok: true,
			...(await browse(owned.record, (conn) => deletePattern(conn, parsed.data))),
		};
	} catch (error) {
		return describeRedisError(error, "Could not delete the keys");
	}
}

/** FLUSHDB, only when the caller typed the database's name. */
export async function flushDatabaseAction(
	databaseId: string,
	typedName: string,
): Promise<Ok<object> | Failure> {
	const owned = await ownedRedisDatabase(databaseId);
	if ("error" in owned) return owned;
	if (String(typedName) !== owned.record.name) {
		return { ok: false, error: "Type the database name to confirm." };
	}
	try {
		await browse(owned.record, (conn) => conn.callOk(["FLUSHDB", "ASYNC"]));
		return { ok: true };
	} catch (error) {
		return describeRedisError(error, "Could not flush the database");
	}
}

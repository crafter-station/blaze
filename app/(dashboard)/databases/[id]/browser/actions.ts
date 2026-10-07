"use server";

import { describeRedisError, ownedRedisDatabase } from "@/lib/redis/access";
import { browse, health, keyDetails, memoryUsage, scanKeys } from "@/lib/redis/browse";
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

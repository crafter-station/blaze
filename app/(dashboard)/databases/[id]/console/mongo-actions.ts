"use server";

import { describeMongoError, ownedMongoDatabase } from "@/lib/mongo/access";
import { sampleShapes } from "@/lib/mongo/browse";
import { runShell } from "@/lib/mongo/run";
import type { Failure, ShellContext, ShellOutcome } from "@/lib/mongo/types";

/**
 * Server actions behind the Mongo Shell.
 *
 * Ownership first, then the tenant's own user over TLS — the same boundary as the
 * Browser. The shell's own rules (blocked commands, confirmations, result caps) make a
 * short-lived request behave predictably; they do not grant or deny access.
 */

const MAX_SOURCE = 512_000;

export async function runMongoShellAction(
	databaseId: string,
	source: string,
	confirmed: boolean | string = false,
): Promise<ShellOutcome | ({ source: string } & Failure)> {
	const text = String(source ?? "");
	const owned = await ownedMongoDatabase(databaseId);
	if ("error" in owned) return { source: text, ...owned };
	if (text.length > MAX_SOURCE)
		return { source: text, ok: false, error: "The command is longer than 512 KB." };
	try {
		return await runShell(
			owned.record,
			text,
			typeof confirmed === "string" ? confirmed : confirmed === true,
		);
	} catch (error) {
		return { source: text, ...describeMongoError(error, "The command failed") };
	}
}

/**
 * Collection names and sampled field paths with their BSON types, for completion. Keys and
 * types only: no value from the database reaches the browser through this.
 */
export async function mongoShellContextAction(
	databaseId: string,
): Promise<({ ok: true } & ShellContext) | Failure> {
	const owned = await ownedMongoDatabase(databaseId);
	if ("error" in owned) return owned;
	try {
		const shapes = await sampleShapes(owned.record);
		return { ok: true, collections: shapes.map((s) => s.name), shapes };
	} catch (error) {
		return describeMongoError(error, "Could not read the collections");
	}
}

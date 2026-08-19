"use server";

import { revalidatePath } from "next/cache";
import { AccountDeletionError, deleteAccount } from "@/lib/account";
import { ApiKeyLimitError, createApiKey, revokeApiKey } from "@/lib/api-keys";
import { requireUser } from "@/lib/auth";
import { type Engine, isEngine } from "@/lib/engines/types";
import { sampleDatabase } from "@/lib/metrics";
import {
	createDatabase,
	destroyDatabase,
	getOwnedDatabase,
	QuotaExceededError,
	resetDatabasePassword,
} from "@/lib/provision";
import { type QueryOutcome, runTenantQuery } from "@/lib/query";

export interface ActionResult {
	ok: boolean;
	error?: string;
	/** Provisioning wall-clock, surfaced so the 200ms claim stays measured, not asserted. */
	tookMs?: number;
}

export async function createDatabaseAction(formData: FormData): Promise<ActionResult> {
	const user = await requireUser();

	const engine = String(formData.get("engine") ?? "postgres");
	if (!isEngine(engine)) return { ok: false, error: `Unknown engine: ${engine}` };

	const name = String(formData.get("name") ?? "").trim();
	const ttlHours = Number(formData.get("ttlHours") ?? 0);

	try {
		const created = await createDatabase(user, {
			engine: engine as Engine,
			name: name || undefined,
			ttlMs: ttlHours > 0 ? ttlHours * 60 * 60 * 1000 : null,
			createdVia: "dashboard",
		});
		revalidatePath("/projects");
		revalidatePath("/databases");
		return { ok: true, tookMs: created.tookMs };
	} catch (error) {
		// Quota is a normal outcome, not a fault — it deserves its own message rather than
		// being flattened into "something went wrong".
		if (error instanceof QuotaExceededError) return { ok: false, error: error.message };
		return { ok: false, error: error instanceof Error ? error.message : "Failed to create" };
	}
}

export async function deleteDatabaseAction(databaseId: string): Promise<ActionResult> {
	const user = await requireUser();
	try {
		await destroyDatabase(user, databaseId);
		revalidatePath("/projects");
		revalidatePath("/databases");
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : "Failed to delete" };
	}
}

/**
 * Rotate a database's password.
 *
 * The new connection string comes back in the result rather than only being written to the
 * database, so the UI can show it immediately — the moment right after a rotation is
 * exactly when someone needs to paste it somewhere.
 */
export async function resetPasswordAction(
	databaseId: string,
): Promise<ActionResult & { connectionString?: string }> {
	const user = await requireUser();
	try {
		const connectionString = await resetDatabasePassword(user, databaseId);
		revalidatePath("/databases");
		revalidatePath(`/databases/${databaseId}`);
		return { ok: true, connectionString };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : "Failed to reset" };
	}
}

/**
 * Create an API key.
 *
 * The token is returned here and nowhere else — it is never persisted in a readable form,
 * so if the caller does not capture it now it is gone for good.
 */
export async function createApiKeyAction(
	formData: FormData,
): Promise<ActionResult & { token?: string; name?: string }> {
	const user = await requireUser();
	const name = String(formData.get("name") ?? "").trim();

	try {
		const created = await createApiKey(user, name);
		revalidatePath("/api-keys");
		return { ok: true, token: created.token, name: created.name };
	} catch (error) {
		if (error instanceof ApiKeyLimitError) return { ok: false, error: error.message };
		return { ok: false, error: error instanceof Error ? error.message : "Failed to create key" };
	}
}

export async function revokeApiKeyAction(keyId: string): Promise<ActionResult> {
	const user = await requireUser();
	try {
		await revokeApiKey(user, keyId);
		revalidatePath("/api-keys");
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : "Failed to revoke" };
	}
}

/**
 * Delete the account and everything it owns.
 *
 * Guarded by a typed confirmation in the UI, and by `deleteAccount` aborting before it
 * touches anything if a physical database cannot be dropped — a half-deleted account
 * leaves tenant data on disk that nothing will ever reclaim.
 */
export async function deleteAccountAction(
	confirmation: string,
): Promise<ActionResult & { databasesDropped?: number }> {
	const user = await requireUser();

	if (confirmation.trim().toLowerCase() !== user.email.toLowerCase()) {
		return { ok: false, error: "Type your email exactly to confirm." };
	}

	try {
		const { databasesDropped } = await deleteAccount(user);
		return { ok: true, databasesDropped };
	} catch (error) {
		if (error instanceof AccountDeletionError) return { ok: false, error: error.message };
		return { ok: false, error: error instanceof Error ? error.message : "Failed to delete" };
	}
}

/**
 * Take a metrics sample on demand.
 *
 * The cron sweep runs every 5 minutes, which is the right cadence for quota enforcement
 * and the wrong one for someone who just created a database and wants to see a chart.
 * Ownership is checked here because this reaches out to the engine — an unauthenticated
 * caller could otherwise use it to probe instances.
 */
export async function sampleDatabaseAction(databaseId: string): Promise<ActionResult> {
	const user = await requireUser();

	const owned = await getOwnedDatabase(user.id, databaseId);
	if (!owned) return { ok: false, error: "Database not found" };

	try {
		const result = await sampleDatabase(databaseId);
		revalidatePath(`/databases/${databaseId}/monitoring`);
		return result.error ? { ok: false, error: result.error } : { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : "Failed to sample" };
	}
}

/**
 * Execute SQL against a database the caller owns.
 *
 * Ownership is checked here; everything else is enforced by the database itself, because
 * the query runs as the tenant's own role rather than as the instance admin. There is
 * deliberately no SQL allow-list or keyword filter: this is the user's own database and
 * DROP TABLE is a legitimate thing to want. Blocking statements by pattern would give the
 * appearance of safety while being trivially bypassed.
 */
export async function runQueryAction(databaseId: string, sql: string): Promise<QueryOutcome> {
	const user = await requireUser();

	const record = await getOwnedDatabase(user.id, databaseId);
	if (!record) return { ok: false, error: "Database not found" };

	if (record.status === "suspended") {
		return { ok: false, error: "This database is suspended — free storage to resume it." };
	}

	return runTenantQuery(record, sql);
}

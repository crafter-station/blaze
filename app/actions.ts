"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { type Engine, isEngine } from "@/lib/engines/types";
import { createDatabase, destroyDatabase, QuotaExceededError } from "@/lib/provision";

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
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : "Failed to delete" };
	}
}

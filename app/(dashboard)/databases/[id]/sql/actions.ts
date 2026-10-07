"use server";

import { requireUser } from "@/lib/auth";
import { ENGINE_CONFIG } from "@/lib/engines/types";
import { getOwnedDatabase } from "@/lib/provision";
import { MAX_BATCH_STATEMENTS, runTenantBatch } from "@/lib/query";
import { introspectSchema, tableDdl } from "@/lib/sql/introspect";
import type { BatchOutcome, SchemaSnapshot } from "@/lib/sql/types";

/**
 * Server actions behind the SQL console.
 *
 * Every one of them resolves the database through `getOwnedDatabase` with the session's
 * user, so an id from the client is only ever a reference, never a capability. Everything
 * past that runs as the tenant's own role (lib/tenant-db.ts): the engine's grants are the
 * real boundary, exactly as for a direct connection.
 */

type Owned = NonNullable<Awaited<ReturnType<typeof getOwnedDatabase>>>;

async function ownedSqlDatabase(
	databaseId: string,
): Promise<{ record: Owned } | { error: string }> {
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, String(databaseId));
	if (!record) return { error: "Database not found" };
	if (!ENGINE_CONFIG[record.engine].hasSql) return { error: "This engine has no SQL console" };
	if (record.status === "suspended") {
		return { error: "This database is suspended. Free storage to resume it." };
	}
	return { record };
}

function message(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

export async function introspectAction(
	databaseId: string,
): Promise<{ ok: true; snapshot: SchemaSnapshot } | { ok: false; error: string }> {
	const owned = await ownedSqlDatabase(databaseId);
	if ("error" in owned) return { ok: false, error: owned.error };
	try {
		return { ok: true, snapshot: await introspectSchema(owned.record) };
	} catch (error) {
		return { ok: false, error: message(error, "Could not read the schema") };
	}
}

export async function tableDdlAction(
	databaseId: string,
	schema: string,
	table: string,
): Promise<{ ok: true; ddl: string } | { ok: false; error: string }> {
	const owned = await ownedSqlDatabase(databaseId);
	if ("error" in owned) return { ok: false, error: owned.error };
	try {
		const ddl = await tableDdl(owned.record, String(schema), String(table));
		return ddl ? { ok: true, ddl } : { ok: false, error: "Table not found" };
	} catch (error) {
		return { ok: false, error: message(error, "Could not read the definition") };
	}
}

/**
 * Run the statements the editor split out, in order, on one connection.
 *
 * No keyword filtering, same as `runQueryAction`: it is the tenant's own database and
 * DROP TABLE is a legitimate thing to want. The console asks for confirmation before
 * destructive statements; that is a UX guard, and the role's grants remain the boundary.
 */
export async function runSqlAction(
	databaseId: string,
	statements: string[],
): Promise<BatchOutcome> {
	const owned = await ownedSqlDatabase(databaseId);
	if ("error" in owned) return { ok: false, error: owned.error, results: [] };

	const list = (Array.isArray(statements) ? statements : [])
		.map((s) => String(s))
		.filter((s) => s.trim().length > 0);
	if (list.length === 0) return { ok: false, error: "Nothing to run", results: [] };
	if (list.length > MAX_BATCH_STATEMENTS) {
		return {
			ok: false,
			error: `Run at most ${MAX_BATCH_STATEMENTS} statements at a time.`,
			results: [],
		};
	}

	const results = await runTenantBatch(owned.record, list);
	return { ok: results.every((r) => r.ok), results };
}

import { z } from "zod";
import { apiError, apiJson, authenticate, isResponse, readBody } from "@/lib/api/http";
import { getOwnedDatabase } from "@/lib/provision";
import { runTenantQuery } from "@/lib/query";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const QueryBody = z.object({
	sql: z.string().min(1).max(100_000),
});

/**
 * Run SQL against a database the caller owns.
 *
 * This is what makes blaze useful to an agent rather than merely provisionable by one:
 * create a database and immediately create its schema and seed it, without the agent
 * needing a Postgres driver or a network path to the instance.
 *
 * It runs as the tenant's role, exactly like the dashboard editor — so the blast radius
 * of an API key is the databases that key's owner already has, and nothing else on the
 * instance. A failed statement is a 200 with `ok: false`: the HTTP call succeeded, the
 * SQL did not, and collapsing those two into one status makes agents retry transport
 * failures and SQL errors identically when they should not.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
	const user = await authenticate(request);
	if (isResponse(user)) return user;

	const { id } = await ctx.params;
	const record = await getOwnedDatabase(user.id, id);
	if (!record) return apiError("not_found", "No database with that id.");

	if (record.status === "suspended") {
		return apiError("database_suspended", "Database is suspended — free storage to resume it.");
	}

	const body = await readBody(request, QueryBody);
	if (isResponse(body)) return body;

	const result = await runTenantQuery(record, body.sql);

	return apiJson({
		ok: result.ok,
		error: result.error ?? null,
		command: result.command ?? null,
		columns: result.columns ?? [],
		rows: result.rows ?? [],
		row_count: result.rowCount ?? 0,
		truncated: result.truncated ?? false,
		duration_ms: result.durationMs ?? 0,
	});
}

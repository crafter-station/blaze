import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ENGINE_CONFIG } from "@/lib/engines/types";
import { getOwnedDatabase } from "@/lib/provision";
import { assistantEnabled, streamAssistant, takeAssistantQuota } from "@/lib/sql/assistant";
import { isSqlEngine } from "@/lib/sql/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/databases/:id/assistant: "Ask AI" for the SQL console, the Redis console and
 * the Mongo shell.
 *
 * A route handler rather than a server action because the answer streams, and because
 * Next dispatches server actions one at a time per client: a long answer would otherwise
 * hold up every query run behind it. Protected by the Clerk session (proxy.ts), then by
 * database ownership, then by a per-user hourly quota.
 */

const body = z.object({
	mode: z.enum(["generate", "explain", "fix"]),
	prompt: z.string().max(4_000).optional(),
	sql: z.string().max(40_000).optional(),
	error: z.string().max(4_000).optional(),
});

function fail(status: number, message: string, headers?: HeadersInit) {
	return Response.json({ error: message }, { status, headers });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (!assistantEnabled()) {
		return fail(503, "The assistant is not configured on this server (OPENAI_API_KEY is unset).");
	}

	let user: Awaited<ReturnType<typeof requireUser>>;
	try {
		user = await requireUser();
	} catch {
		return fail(401, "Sign in to use the assistant.");
	}

	const { id } = await params;
	const record = await getOwnedDatabase(user.id, id);
	const sql = !!record && ENGINE_CONFIG[record.engine].hasSql && isSqlEngine(record.engine);
	if (!record || !(sql || record.engine === "redis" || record.engine === "mongo")) {
		return fail(404, "Database not found");
	}

	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return fail(400, "Invalid request");
	const input = parsed.data;
	if (input.mode === "generate" && !input.prompt?.trim())
		return fail(400, "Describe what you want.");
	if (input.mode !== "generate" && !input.sql?.trim())
		return fail(
			400,
			record.engine === "redis" || record.engine === "mongo"
				? "There is no command to work on."
				: "There is no SQL to work on.",
		);

	const quota = await takeAssistantQuota(user.id, record.id, input.mode);
	if (!quota.ok) {
		return fail(429, "You have reached the assistant's hourly limit. Try again a little later.", {
			"Retry-After": String(quota.retryAfterSeconds),
		});
	}

	const stream = await streamAssistant(record, input, request.signal);
	return new Response(stream, {
		headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

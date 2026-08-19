import "server-only";
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";
import { authenticateApiKey } from "@/lib/api-keys";
import { ensureUserByClerkId } from "@/lib/auth";
import type { User } from "@/lib/control/schema";

/**
 * Two ways to reach the MCP server, deliberately.
 *
 * - **OAuth**, for agents. The user authorizes once in a browser and the client holds a
 *   Clerk-issued token bound to this resource. Nobody copies a secret, and revoking
 *   access is a Clerk-side action.
 * - **API key**, for curl, CI and anything without a browser to redirect to.
 *
 * Both resolve to the same `User`, so every tool below this line is identical regardless
 * of how the caller arrived. The alternative — an OAuth-only surface — would have meant
 * scripts could not use MCP at all, and an API-key-only surface means every agent setup
 * starts with "go paste a secret", which is the friction this whole change removes.
 */

export interface McpCaller {
	user: User;
	via: "oauth" | "api_key";
}

export async function resolveMcpCaller(request: Request): Promise<McpCaller | null> {
	const header = request.headers.get("authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
	if (!token) return null;

	// blaze's own keys are self-identifying, so there is no ambiguity about which
	// verification path a token belongs to.
	if (token.startsWith("blz_")) {
		const user = await authenticateApiKey(token);
		return user ? { user, via: "api_key" } : null;
	}

	try {
		const clerkAuth = await auth({ acceptsToken: "oauth_token" });
		const info = await verifyClerkToken(clerkAuth, token);
		const clerkUserId = info?.extra?.userId;
		if (typeof clerkUserId !== "string") return null;

		const user = await ensureUserByClerkId(clerkUserId);
		return user ? { user, via: "oauth" } : null;
	} catch {
		// An unverifiable token is simply not authenticated. Distinguishing "expired" from
		// "forged" here would leak information and change nothing the client can act on.
		return null;
	}
}

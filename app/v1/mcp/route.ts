import { NextResponse } from "next/server";
import { resolveMcpCaller } from "@/lib/mcp/auth";
import { callTool, TOOLS } from "@/lib/mcp/tools";
import { publicUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * MCP endpoint, Streamable HTTP transport.
 *
 * The JSON-RPC surface an MCP client actually needs is small and fully specified —
 * `initialize`, `tools/list`, `tools/call`, plus notifications — so it is implemented
 * directly rather than pulling in an SDK built around stdio servers and long-lived
 * sessions. A Next route handler is neither.
 *
 * Two auth paths, both landing on the same user: a Clerk OAuth token (agents authorize
 * once in a browser, nobody copies a secret) or a blaze API key (curl, CI, anything with
 * no browser to redirect to).
 *
 * An unauthenticated call answers 401 with a `WWW-Authenticate` header pointing at the
 * protected-resource document. That header is what makes the OAuth flow start at all —
 * without it a client sees a bare 401 and has nowhere to go.
 */

const PROTOCOL_VERSION = "2025-06-18";

interface RpcRequest {
	jsonrpc: "2.0";
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

function result(id: RpcRequest["id"], value: unknown) {
	return NextResponse.json({ jsonrpc: "2.0", id, result: value });
}

function rpcError(id: RpcRequest["id"], code: number, message: string) {
	return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * 401 with an RFC 9728 challenge. The `resource_metadata` pointer is the whole mechanism:
 * an MCP client reads it, discovers Clerk as the authorization server, registers itself,
 * and opens a browser for consent. A JSON-RPC error body alone would leave the client
 * with nothing to act on, so both are sent.
 */
function unauthorized(id: RpcRequest["id"]) {
	return NextResponse.json(
		{
			jsonrpc: "2.0",
			id,
			error: {
				code: -32001,
				message: "Unauthorized. Authorize via OAuth, or send Authorization: Bearer blz_live_...",
			},
		},
		{
			status: 401,
			headers: {
				"WWW-Authenticate": `Bearer resource_metadata="${publicUrl()}/.well-known/oauth-protected-resource"`,
			},
		},
	);
}

export async function POST(request: Request) {
	let body: RpcRequest;
	try {
		body = await request.json();
	} catch {
		return rpcError(null, -32700, "Parse error");
	}

	const { id, method, params } = body;

	// `initialize` is answered before authenticating, so a client can discover the server
	// and report a clean auth failure on the first real call rather than a confusing one
	// during handshake.
	if (method === "initialize") {
		return result(id, {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: { tools: {} },
			serverInfo: { name: "blaze", version: "0.1.0" },
			instructions:
				"Provision and query managed Postgres databases. create_database returns a " +
				"connection string in about 200ms; run_query executes SQL against a database you " +
				"own without needing a driver.",
		});
	}

	// Notifications carry no id and expect no response body.
	if (method.startsWith("notifications/")) {
		return new NextResponse(null, { status: 202 });
	}

	if (method === "ping") return result(id, {});

	const caller = await resolveMcpCaller(request);
	if (!caller) return unauthorized(id);
	const user = caller.user;

	if (method === "tools/list") {
		return result(id, {
			tools: TOOLS.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			})),
		});
	}

	if (method === "tools/call") {
		const name = String(params?.name ?? "");
		const args = (params?.arguments ?? {}) as Record<string, unknown>;

		try {
			const outcome = await callTool(user, name, args);
			return result(id, {
				content: [{ type: "text", text: outcome.text }],
				isError: outcome.isError ?? false,
			});
		} catch (error) {
			// Tool failures are reported as results with isError, not as JSON-RPC errors: the
			// model should see what went wrong and adapt, not have the call disappear into a
			// transport-level failure it cannot read.
			return result(id, {
				content: [
					{
						type: "text",
						text: error instanceof Error ? error.message : "Tool call failed.",
					},
				],
				isError: true,
			});
		}
	}

	return rpcError(id, -32601, `Method not found: ${method}`);
}

/** Some clients probe with GET before opening a session. */
export async function GET() {
	return NextResponse.json({
		name: "blaze",
		protocolVersion: PROTOCOL_VERSION,
		transport: "streamable-http",
		authentication: {
			oauth: `${publicUrl()}/.well-known/oauth-protected-resource`,
			api_key: "Authorization: Bearer blz_live_...",
		},
		tools: TOOLS.map((tool) => tool.name),
	});
}

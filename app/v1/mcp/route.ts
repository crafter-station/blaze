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
 * Written to work with every major client, which mostly means not assuming the one you
 * tested with:
 *
 * - **CORS**, because claude.ai and chatgpt.com call this from a browser. Without
 *   `WWW-Authenticate` in `Access-Control-Expose-Headers` a browser client cannot read
 *   the 401 challenge and the OAuth flow never starts, even though curl works fine.
 * - **`GET` answers 405 when a stream is requested.** This server is stateless and offers
 *   no server-initiated SSE channel; the spec allows saying so, and clients handle 405
 *   cleanly. Returning 200 with a JSON blob would look like a broken stream instead.
 * - **Protocol version is echoed, not asserted.** Clients in the wild speak 2024-11-05,
 *   2025-03-26 and 2025-06-18. Replying with our newest regardless makes an older client
 *   think it is talking to something it cannot parse.
 *
 * Two auth paths, both landing on the same user: a Clerk OAuth token (agents authorize in
 * a browser, nobody copies a secret) or a blaze API key (curl, CI, anything headless).
 */

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/**
 * Permissive origin, because the credential is a bearer token the client already holds —
 * there is no cookie or ambient authority for a hostile page to ride on, so restricting
 * origins would block legitimate clients without preventing anything.
 */
const CORS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers":
		"Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
	"Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version",
	"Access-Control-Max-Age": "86400",
};

interface RpcRequest {
	jsonrpc: "2.0";
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

function json(body: unknown, init?: ResponseInit) {
	return NextResponse.json(body, {
		...init,
		headers: { ...CORS, ...(init?.headers ?? {}) },
	});
}

function result(id: RpcRequest["id"], value: unknown) {
	return json({ jsonrpc: "2.0", id, result: value });
}

function rpcError(id: RpcRequest["id"], code: number, message: string) {
	return json({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * 401 with an RFC 9728 challenge. The `resource_metadata` pointer is the whole mechanism:
 * a client reads it, discovers the authorization server, registers itself, and opens a
 * browser for consent. A JSON-RPC error body alone leaves the client with nowhere to go.
 */
function unauthorized(id: RpcRequest["id"]) {
	return json(
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

export async function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
	let body: RpcRequest;
	try {
		body = await request.json();
	} catch {
		return rpcError(null, -32700, "Parse error");
	}

	const { id, method, params } = body;

	// Answered before authenticating, so a client can discover the server and report a
	// clean auth failure on its first real call rather than a confusing handshake error.
	if (method === "initialize") {
		const requested = String(params?.protocolVersion ?? "");
		const version = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
			? requested
			: LATEST_PROTOCOL_VERSION;

		return json(
			{
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: version,
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: "blaze", version: "0.1.0" },
					instructions:
						"Provision and query managed Postgres databases. create_database returns a " +
						"connection string in about 200ms; run_query executes SQL against a database " +
						"you own without needing a driver.",
				},
			},
			{ headers: { "MCP-Protocol-Version": version } },
		);
	}

	// Notifications carry no id and expect no response body.
	if (method?.startsWith("notifications/")) {
		return new NextResponse(null, { status: 202, headers: CORS });
	}

	if (method === "ping") return result(id, {});

	const caller = await resolveMcpCaller(request);
	if (!caller) return unauthorized(id);
	const user = caller.user;

	if (method === "tools/list") {
		return result(id, { tools: TOOLS });
	}

	// Declared but empty: clients that probe these expect an empty list, not "method not
	// found", which some surface to the user as a broken server.
	if (method === "resources/list") return result(id, { resources: [] });
	if (method === "prompts/list") return result(id, { prompts: [] });

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
			// Tool failures are results with isError, not JSON-RPC errors: the model should see
			// what went wrong and adapt, not have the call vanish into a transport failure.
			return result(id, {
				content: [
					{ type: "text", text: error instanceof Error ? error.message : "Tool call failed." },
				],
				isError: true,
			});
		}
	}

	return rpcError(id, -32601, `Method not found: ${method}`);
}

/**
 * A client opening the server-to-client SSE stream gets 405: this server is stateless and
 * never initiates messages. Anything else — a human with curl — gets a description.
 */
export async function GET(request: Request) {
	const accept = request.headers.get("accept") ?? "";
	if (accept.includes("text/event-stream")) {
		return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: "POST, DELETE" } });
	}

	return json({
		name: "blaze",
		protocolVersion: LATEST_PROTOCOL_VERSION,
		supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
		transport: "streamable-http",
		authentication: {
			oauth: `${publicUrl()}/.well-known/oauth-protected-resource`,
			api_key: "Authorization: Bearer blz_live_...",
		},
		tools: TOOLS.map((tool) => tool.name),
	});
}

/** Session teardown. Stateless, so there is nothing to tear down — but say so politely. */
export async function DELETE() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

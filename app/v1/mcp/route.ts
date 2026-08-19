import { NextResponse } from "next/server";
import { authenticate, isResponse } from "@/lib/api/http";
import { callTool, TOOLS } from "@/lib/mcp/tools";

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
 * Auth is the same bearer API key as the rest of `/v1`, so a key works identically from
 * curl and from an agent, and revoking it cuts off both.
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

	const user = await authenticate(request);
	if (isResponse(user)) {
		// Translate the HTTP-shaped auth failure into JSON-RPC, so MCP clients surface a
		// real message instead of a transport error.
		return rpcError(id, -32001, "Unauthorized. Set an Authorization: Bearer blz_live_... header.");
	}

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
		authentication: "Authorization: Bearer blz_live_...",
		tools: TOOLS.map((tool) => tool.name),
	});
}

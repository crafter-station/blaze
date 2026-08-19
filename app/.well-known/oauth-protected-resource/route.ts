import {
	metadataCorsOptionsRequestHandler,
	protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next";
import { mcpResourceUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

/**
 * RFC 9728 Protected Resource Metadata — the entry point of the whole MCP authorization
 * flow. A client hits /v1/mcp with no token, gets a 401 pointing here, and reads this
 * document to discover which authorization server to talk to. Without it an MCP client
 * cannot register or authenticate at all.
 */
const handler = protectedResourceHandlerClerk({
	// Must be the canonical public MCP URI: this is the audience tokens are bound to, and
	// deriving it from the request yields the container's address behind Traefik.
	resource: mcpResourceUrl(),
	// Only scopes Clerk can actually issue. Clients request exactly what this lists, and
	// the authorization server rejects anything it cannot mint — advertising a custom
	// scope like `blaze:write` breaks the flow rather than tightening it.
	scopes_supported: ["openid", "profile", "email"],
});

const options = metadataCorsOptionsRequestHandler();

export { handler as GET, options as OPTIONS };

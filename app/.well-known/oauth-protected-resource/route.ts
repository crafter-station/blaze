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
	/*
	 * Exactly the scopes a dynamically-registered client on THIS instance is granted, which
	 * is `profile email offline_access` — verified by reading back a registered client.
	 *
	 * Not `openid`. Clients request precisely what this document lists, and this instance
	 * refuses `openid` to dynamic clients:
	 *
	 *   invalid_scope: The OAuth 2.0 Client is not allowed to request scope 'openid'
	 *
	 * So this list is not a policy choice — it has to mirror what the authorization server
	 * will actually mint, and that differs per instance. `offline_access` is included
	 * deliberately: without a refresh token the agent has to re-authorize whenever the
	 * access token expires.
	 */
	scopes_supported: ["profile", "email", "offline_access"],
});

const options = metadataCorsOptionsRequestHandler();

export { handler as GET, options as OPTIONS };

/**
 * The origin clients actually reach blaze on.
 *
 * Behind Traefik the incoming request URL is the container's own address, so anything
 * derived from it advertises the wrong host. That is cosmetic in most places but
 * load-bearing for MCP: the `resource` value is the audience an access token is bound to
 * (RFC 8707), and a token minted for "localhost" is not valid for this server.
 */
export function publicUrl(): string {
	const configured = process.env.APP_URL?.trim();
	if (configured) return configured.replace(/\/+$/, "");
	return "http://localhost:3000";
}

/** Canonical URI of the MCP endpoint, used as the OAuth resource identifier. */
export function mcpResourceUrl(): string {
	return `${publicUrl()}/v1/mcp`;
}

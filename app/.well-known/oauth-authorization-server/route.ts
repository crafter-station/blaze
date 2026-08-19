import {
	authServerMetadataHandlerClerk,
	metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";

export const dynamic = "force-dynamic";

/**
 * Mirrors Clerk's RFC 8414 authorization server metadata on our own origin.
 *
 * Some MCP clients look for the authorization server document next to the resource
 * rather than following the issuer, so serving both keeps discovery working either way.
 */
const handler = authServerMetadataHandlerClerk();

const options = metadataCorsOptionsRequestHandler();

export { handler as GET, options as OPTIONS };

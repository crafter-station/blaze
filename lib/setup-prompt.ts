/**
 * The paste-into-Claude setup prompt.
 *
 * Lives in one place because it appears in three: the landing page, the docs, and the
 * dialog shown the one time a new API key is visible. Three hand-written copies would
 * drift, and the version with the real key in it is the one that must never be wrong.
 *
 * It is written as a prompt rather than a shell command on purpose. A command only
 * configures; a prompt configures, verifies, and leaves the user with a working database
 * and a model that has just demonstrated what it can now do — which is the actual goal.
 */

export const MCP_URL = "https://blaze.crafter.run/v1/mcp";
export const KEY_PLACEHOLDER = "blz_live_YOUR_KEY_HERE";

export function setupPrompt(apiKey: string = KEY_PLACEHOLDER): string {
	return `Set up blaze so you can provision Postgres databases for me.

1. Add it as an MCP server in Claude Code:
   - name: blaze
   - transport: http
   - url: ${MCP_URL}
   - header: Authorization: Bearer ${apiKey}

   Use \`claude mcp add\` for this.

2. Reconnect, then call blaze's \`list_databases\` tool to confirm it works.

3. Create a Postgres database named "scratch" with a 24 hour TTL, run
   \`select version()\` against it, and show me the connection string.

Then tell me briefly what you can now do with blaze.`;
}

/**
 * The paste-into-your-agent setup prompt.
 *
 * Lives in one place because it appears in three: the landing page, the docs, and the
 * dialog shown the one time a new API key is visible.
 *
 * Two properties it is built around:
 *
 * 1. **No secret by default.** blaze advertises OAuth, so the client registers itself and
 *    opens a browser for consent. Nothing is copied, pasted, or accidentally committed.
 *    An agent that can provision databases should not need you to hand it a credential
 *    first.
 * 2. **Client-agnostic.** It lists the concrete step for each major client rather than
 *    assuming one, because the agent reading it knows which one it is and can pick — and
 *    a prompt that says "run `claude mcp add`" is simply wrong in ChatGPT.
 *
 * It is a prompt rather than a command on purpose: a command only configures, while this
 * configures, verifies, creates a database and leaves the user with a model that has just
 * demonstrated what it can now do.
 */

export const MCP_URL = "https://blaze.crafter.run/v1/mcp";

/**
 * @param apiKey when supplied, configures a static key instead of OAuth. Only needed
 *        where a browser consent step is impossible, such as CI.
 */
export function setupPrompt(apiKey?: string): string {
	const auth = apiKey
		? `   - header: Authorization: Bearer ${apiKey}`
		: `   No API key needed — blaze uses OAuth, so approve it in the browser when asked.`;

	return `Set up blaze so you can provision Postgres databases for me.

1. Add it as an MCP server:
   - name: blaze
   - transport: streamable http
   - url: ${MCP_URL}
${auth}

   Whichever client you are, use the matching step:
   - Claude Code:    claude mcp add --transport http blaze ${MCP_URL}
   - Claude Desktop: Settings > Connectors > Add custom connector
   - ChatGPT:        Settings > Connectors > Add (developer mode)
   - Codex:          add [mcp_servers.blaze] with that url to ~/.codex/config.toml

2. Reconnect, then call blaze's \`list_databases\` tool to confirm it works.

3. Create a Postgres database named "scratch" with a 24 hour TTL, run
   \`select version()\` against it, and show me the connection string.

Then tell me briefly what else you can do with blaze.`;
}

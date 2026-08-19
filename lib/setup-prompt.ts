/**
 * The paste-into-Claude setup prompt.
 *
 * Lives in one place because it appears in three: the landing page, the docs, and the
 * dialog shown the one time a new API key is visible.
 *
 * The default form asks for **no secret at all**. blaze's MCP endpoint advertises OAuth,
 * so the client discovers the authorization server, registers itself, and opens a browser
 * for consent — the user approves once and the agent holds a token nobody had to copy,
 * paste, or accidentally commit. An agent that can already provision databases should not
 * need you to hand it a credential first.
 *
 * The keyed form still exists for environments with no browser to redirect to.
 */

export const MCP_URL = "https://blaze.crafter.run/v1/mcp";

/**
 * @param apiKey when supplied, configures the server with a static key instead of OAuth.
 *        Only useful where a browser consent step is impossible.
 */
export function setupPrompt(apiKey?: string): string {
	const authStep = apiKey
		? `   - header: Authorization: Bearer ${apiKey}

   Use \`claude mcp add\` with that header.`
		: `   No API key needed — blaze uses OAuth. Use \`claude mcp add\`, then when it
   asks you to authorize, open the link and approve with your blaze account.`;

	return `Set up blaze so you can provision Postgres databases for me.

1. Add it as an MCP server in Claude Code:
   - name: blaze
   - transport: http
   - url: ${MCP_URL}
${authStep}

2. Reconnect, then call blaze's \`list_databases\` tool to confirm it works.

3. Create a Postgres database named "scratch" with a 24 hour TTL, run
   \`select version()\` against it, and show me the connection string.

Then tell me briefly what else you can do with blaze.`;
}

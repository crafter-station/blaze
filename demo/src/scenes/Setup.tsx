import { interpolate, useCurrentFrame } from "remotion";
import { Chip, Panel } from "../components/Panel";
import { mono, sans } from "../fonts";
import { theme } from "../theme";

const PROMPT = `Set up blaze so you can provision Postgres databases for me.

1. Add it as an MCP server:
   - name: blaze
   - transport: streamable http
   - url: https://blaze.crafter.run/v1/mcp
   No API key needed — blaze uses OAuth.

2. Call list_databases to confirm it works.

3. Create a database named "scratch" with a 24 hour TTL.`;

/**
 * Types the prompt out rather than showing it whole: the reveal is what communicates
 * "this is one thing you paste", where a static block reads as documentation to study.
 */
export const Setup: React.FC = () => {
	const frame = useCurrentFrame();
	const shown = Math.floor(interpolate(frame, [14, 150], [0, PROMPT.length], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	}));

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 26,
				padding: "0 160px",
			}}
		>
			<Panel title="Paste into your agent" width={1280}>
				<pre
					style={{
						fontFamily: mono,
						fontSize: 25,
						lineHeight: 1.55,
						color: theme.muted,
						margin: 0,
						whiteSpace: "pre-wrap",
						minHeight: 400,
					}}
				>
					{PROMPT.slice(0, shown)}
					{shown < PROMPT.length && (
						// Blinks at 2Hz so the block reads as live rather than as a screenshot.
						<span style={{ opacity: Math.floor(frame / 8) % 2 ? 1 : 0, color: theme.fg }}>▋</span>
					)}
				</pre>
			</Panel>

			<div style={{ display: "flex", gap: 16, alignItems: "center", fontFamily: sans }}>
				<Chip>OAuth — no key to copy</Chip>
				<span style={{ color: theme.muted, fontSize: 24 }}>
					Claude Code · Claude Desktop · ChatGPT · Codex
				</span>
			</div>
		</div>
	);
};

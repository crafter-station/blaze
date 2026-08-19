import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { mono, sans } from "../fonts";
import { theme } from "../theme";

/**
 * An MCP tool call as an agent surfaces it: the request, then the result.
 *
 * The two halves animate separately with a gap between them, because the pause is the
 * point — it is where the work happens, and collapsing it would hide the very latency the
 * video is claiming is small.
 */
export const ToolCall: React.FC<{
	tool: string;
	args: string;
	result: React.ReactNode;
	resultDelay?: number;
}> = ({ tool, args, result, resultDelay = 34 }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const req = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
	const res = spring({
		frame: frame - resultDelay,
		fps,
		config: { damping: 200 },
		durationInFrames: 18,
	});

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 18, width: 1280 }}>
			<div
				style={{
					background: theme.popover,
					border: `1px solid ${theme.border}`,
					borderRadius: theme.radius,
					padding: "20px 24px",
					opacity: interpolate(req, [0, 1], [0, 1]),
					transform: `translateY(${interpolate(req, [0, 1], [16, 0])}px)`,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
					<span style={{ fontFamily: mono, fontSize: 20, color: theme.muted }}>
						blaze
					</span>
					<span style={{ fontFamily: mono, fontSize: 24, color: theme.fg }}>{tool}</span>
				</div>
				<pre
					style={{
						fontFamily: mono,
						fontSize: 23,
						color: theme.muted,
						margin: 0,
						whiteSpace: "pre-wrap",
					}}
				>
					{args}
				</pre>
			</div>

			<div
				style={{
					opacity: interpolate(res, [0, 1], [0, 1]),
					transform: `translateY(${interpolate(res, [0, 1], [16, 0])}px)`,
					fontFamily: sans,
				}}
			>
				{result}
			</div>
		</div>
	);
};

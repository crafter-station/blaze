import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { mono, sans } from "../fonts";
import { theme } from "../theme";

export const Outro: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 30,
				opacity: interpolate(enter, [0, 1], [0, 1]),
				transform: `scale(${interpolate(enter, [0, 1], [0.97, 1])})`,
			}}
		>
			<p style={{ fontFamily: sans, fontSize: 34, color: theme.muted, margin: 0 }}>
				5 databases · 500&nbsp;MB each · free while in alpha
			</p>
			<h2
				style={{
					fontFamily: mono,
					fontSize: 96,
					fontWeight: 600,
					letterSpacing: -3,
					color: theme.fg,
					margin: 0,
				}}
			>
				blaze.crafter.run
			</h2>
		</div>
	);
};

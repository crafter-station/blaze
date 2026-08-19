import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Eyebrow } from "../components/Captions";
import { mono, sans } from "../fonts";
import { theme } from "../theme";

export const Title: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				padding: "0 160px",
				gap: 28,
				opacity: interpolate(enter, [0, 1], [0, 1]),
				transform: `translateY(${interpolate(enter, [0, 1], [24, 0])}px)`,
			}}
		>
			<Eyebrow>blaze</Eyebrow>
			<h1
				style={{
					fontFamily: sans,
					fontSize: 132,
					fontWeight: 600,
					letterSpacing: -4,
					lineHeight: 1.02,
					color: theme.fg,
					margin: 0,
				}}
			>
				Any database in{" "}
				<span style={{ fontFamily: mono, letterSpacing: -6 }}>200ms</span>.
			</h1>
			<p style={{ fontFamily: sans, fontSize: 38, color: theme.muted, margin: 0, maxWidth: 1500 }}>
				Free managed Postgres for agents and the people who build them.
			</p>
		</div>
	);
};

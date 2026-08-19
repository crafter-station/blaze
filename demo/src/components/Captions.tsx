import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { mono, sans } from "../fonts";
import { theme } from "../theme";
import timing from "../../public/timing.json";

/**
 * Subtitles, driven by the measured audio timings.
 *
 * Sits above every scene at absolute video time rather than inside a scene, so a caption
 * is never clipped by a cut: narration and scene bounds come from the same timing file,
 * but only one of them should own the text on screen.
 *
 * Rendered as burned-in text rather than a sidecar file because the video will be posted
 * to places that autoplay muted and do not carry subtitle tracks — a caption nobody can
 * turn on is not a caption.
 */
export const Captions: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const ms = (frame / fps) * 1000;

	const line = timing.lines.find((l) => ms >= l.startMs && ms < l.startMs + l.durationMs);
	if (!line) return null;

	const elapsed = ms - line.startMs;
	// Quick in, quick out: a caption that lingers overlaps the next one and reads as a
	// double exposure.
	const opacity = interpolate(
		elapsed,
		[0, 140, line.durationMs - 180, line.durationMs],
		[0, 1, 1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	return (
		<div
			style={{
				position: "absolute",
				left: 0,
				right: 0,
				bottom: 88,
				display: "flex",
				justifyContent: "center",
				padding: "0 200px",
				opacity,
			}}
		>
			<p
				style={{
					fontFamily: sans,
					fontSize: 34,
					lineHeight: 1.35,
					color: theme.fg,
					textAlign: "center",
					margin: 0,
					background: "rgba(0,0,0,0.55)",
					border: `1px solid ${theme.border}`,
					borderRadius: theme.radius,
					padding: "16px 28px",
					backdropFilter: "blur(8px)",
					// Text shadow as well as the panel: the backdrop is bright in places, and a
					// caption that becomes unreadable over one cell defeats the purpose.
					textShadow: "0 2px 12px rgba(0,0,0,0.8)",
					maxWidth: 1400,
				}}
			>
				{line.text}
			</p>
		</div>
	);
};

/** Small monospace label used by scenes for the "what you are looking at" line. */
export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<p
		style={{
			fontFamily: mono,
			fontSize: 22,
			letterSpacing: 2,
			textTransform: "uppercase",
			color: theme.muted,
			margin: 0,
		}}
	>
		{children}
	</p>
);

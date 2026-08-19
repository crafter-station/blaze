import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { mono } from "../fonts";
import { theme } from "../theme";

/**
 * The card shell used across scenes, matching the product's surfaces: #161616 on black
 * with a 10%-white border.
 *
 * `delay` staggers entrances so a scene assembles rather than appearing all at once —
 * simultaneous entrances read as a slide, staggered ones read as a demo.
 */
export const Panel: React.FC<{
	title?: string;
	delay?: number;
	width?: number | string;
	children: React.ReactNode;
}> = ({ title, delay = 0, width = 1200, children }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const enter = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 22 });
	const opacity = interpolate(enter, [0, 1], [0, 1]);
	const lift = interpolate(enter, [0, 1], [26, 0]);

	return (
		<div
			style={{
				width,
				background: theme.card,
				border: `1px solid ${theme.border}`,
				borderRadius: theme.radius + 4,
				overflow: "hidden",
				opacity,
				transform: `translateY(${lift}px)`,
				boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
			}}
		>
			{title && (
				<div
					style={{
						padding: "16px 24px",
						borderBottom: `1px solid ${theme.border}`,
						fontFamily: mono,
						fontSize: 20,
						color: theme.muted,
					}}
				>
					{title}
				</div>
			)}
			<div style={{ padding: 24 }}>{children}</div>
		</div>
	);
};

/** A dot-and-label status chip, same semantics as the product's StatusPill. */
export const Chip: React.FC<{ color?: string; children: React.ReactNode }> = ({
	color = theme.success,
	children,
}) => (
	<span
		style={{
			display: "inline-flex",
			alignItems: "center",
			gap: 10,
			border: `1px solid ${color}40`,
			background: `${color}1a`,
			color,
			borderRadius: 999,
			padding: "6px 14px",
			fontFamily: mono,
			fontSize: 19,
		}}
	>
		<span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
		{children}
	</span>
);

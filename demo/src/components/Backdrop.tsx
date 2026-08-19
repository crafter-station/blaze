import { useCurrentFrame } from "remotion";
import { theme } from "../theme";

/**
 * The landing page's drifting cell grid, rebuilt for video.
 *
 * Drawn as absolutely-positioned cells rather than an SVG pattern because Remotion
 * renders each frame independently — a CSS animation would be frozen at its start state
 * in every frame. Motion has to be derived from the frame number instead.
 */
const CELL = 26;
const SIZE = 15;

export const Backdrop: React.FC = () => {
	const frame = useCurrentFrame();
	// One full cell of travel per 40 frames, so the loop is seamless: after 26px the grid
	// is indistinguishable from where it started.
	const offset = (frame / 40) * CELL % CELL;

	const cols = Math.ceil(1920 / CELL) + 1;
	const rows = Math.ceil(1080 / CELL) + 2;

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				overflow: "hidden",
				background: theme.bg,
				maskImage: "radial-gradient(ellipse 80% 65% at 50% 42%, black 0%, transparent 85%)",
				WebkitMaskImage: "radial-gradient(ellipse 80% 65% at 50% 42%, black 0%, transparent 85%)",
			}}
		>
			<div style={{ position: "absolute", inset: 0, transform: `translateY(${offset - CELL}px)` }}>
				{Array.from({ length: rows }).map((_, row) =>
					Array.from({ length: cols }).map((_, col) => {
						// Deterministic per-cell brightness: a few cells read brighter, like a
						// contribution graph, without any randomness that would flicker per frame.
						const n = Math.abs(Math.sin((row * 31 + col * 17) * 0.7));
						const bright = n > 0.93;
						return (
							<div
								key={`${row}-${col}`}
								style={{
									position: "absolute",
									left: col * CELL,
									top: row * CELL,
									width: SIZE,
									height: SIZE,
									borderRadius: 3.5,
									background: theme.fg,
									opacity: bright ? 0.05 + n * 0.05 : 0.022,
								}}
							/>
						);
					}),
				)}
			</div>
		</div>
	);
};

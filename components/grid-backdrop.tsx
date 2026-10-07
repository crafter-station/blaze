/**
 * Dot-matrix field behind the landing hero, drawn on the same grid language as the
 * isotype and the Doto wordmark.
 *
 * Cheapest first:
 *   1. an SVG `<pattern>` of dots, one element regardless of how many are visible;
 *   2. a handful of brighter dots drifting at a different speed, which is what stops it
 *      reading as wallpaper;
 *   3. a mask that fades toward the edges so the field never competes with the copy.
 *
 * No client JS: CSS animation only, so it stays a server component and cannot produce a
 * hydration mismatch. Positions come from a deterministic hash rather than Math.random()
 * for the same reason. Motion stops under prefers-reduced-motion (see globals.css).
 */

/** Deterministic 0..1 from an index. Same value on server and client. */
function noise(index: number): number {
	const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
	return value - Math.floor(value);
}

const HIGHLIGHTS = Array.from({ length: 40 }, (_, index) => {
	const a = noise(index);
	const b = noise(index + 97);
	const c = noise(index + 211);
	return {
		left: `${(Math.round(a * 60) / 60) * 100}%`,
		top: `${(b * 200).toFixed(2)}%`,
		opacity: 0.25 + c * 0.5,
		brand: index % 5 === 0,
		delay: `-${(c * 18).toFixed(2)}s`,
	};
});

export function GridBackdrop() {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_70%_75%_at_50%_30%,black_20%,transparent_100%)]"
		>
			<svg className="blaze-drift absolute inset-x-0 top-0 h-[200%] w-full text-foreground/[0.14]">
				<title>Decorative dot grid</title>
				<defs>
					<pattern id="blaze-dots" width="22" height="22" patternUnits="userSpaceOnUse">
						<circle cx="11" cy="11" r="1.6" fill="currentColor" />
					</pattern>
				</defs>
				<rect width="100%" height="100%" fill="url(#blaze-dots)" />
			</svg>

			<div className="blaze-drift-slow absolute inset-x-0 top-0 h-[200%] w-full">
				{HIGHLIGHTS.map((dot) => (
					<span
						key={`${dot.left}-${dot.top}`}
						className={`blaze-pulse absolute size-[5px] rounded-full ${dot.brand ? "bg-brand" : "bg-foreground"}`}
						style={{
							left: dot.left,
							top: dot.top,
							opacity: dot.brand ? dot.opacity : dot.opacity * 0.5,
							animationDelay: dot.delay,
						}}
					/>
				))}
			</div>

			<div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background to-transparent" />
		</div>
	);
}

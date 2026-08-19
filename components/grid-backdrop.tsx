/**
 * Drifting cell grid behind the landing page.
 *
 * Three layers, cheapest first:
 *   1. an SVG `<pattern>` of rounded cells — one element regardless of how many cells are
 *      visible, rather than the ~1000 divs a DOM grid would need;
 *   2. a handful of brighter cells drifting at a different speed, which is what stops it
 *      reading as wallpaper — parallax is the difference between "texture" and "alive";
 *   3. a mask that fades everything toward the centre, so the backdrop never competes
 *      with the text sitting on top of it.
 *
 * No client JS: everything is CSS animation, so this stays a server component and cannot
 * produce a hydration mismatch. Cell opacities come from a deterministic hash of the
 * index rather than Math.random() for the same reason.
 *
 * Honours prefers-reduced-motion — a full-viewport moving field is exactly the kind of
 * thing that triggers vestibular symptoms, and the design still works static.
 */

/** Deterministic 0..1 from an index. Same value on server and client, unlike Math.random. */
function noise(index: number): number {
	const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
	return value - Math.floor(value);
}

const HIGHLIGHTS = Array.from({ length: 72 }, (_, index) => {
	const a = noise(index);
	const b = noise(index + 97);
	const c = noise(index + 211);
	return {
		left: `${(a * 100).toFixed(2)}%`,
		top: `${(b * 200).toFixed(2)}%`,
		opacity: 0.16 + c * 0.42,
		// Staggered so they do not pulse in unison.
		delay: `-${(c * 18).toFixed(2)}s`,
	};
});

export function GridBackdrop() {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none fixed inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_95%_80%_at_50%_38%,black_35%,transparent_100%)]"
		>
			{/* Base field: one <pattern>, tiled, twice viewport height so the loop is seamless. */}
			<svg className="blaze-drift absolute inset-x-0 top-0 h-[200%] w-full text-foreground/[0.16]">
				<title>Decorative grid</title>
				<defs>
					<pattern id="blaze-cells" width="26" height="26" patternUnits="userSpaceOnUse">
						<rect width="15" height="15" x="0" y="0" rx="3.5" fill="currentColor" />
					</pattern>
				</defs>
				<rect width="100%" height="100%" fill="url(#blaze-cells)" />
			</svg>

			{/* Highlights drift slower — the speed difference is what creates depth. */}
			<div className="blaze-drift-slow absolute inset-x-0 top-0 h-[200%] w-full">
				{HIGHLIGHTS.map((cell) => (
					<span
						key={`${cell.left}-${cell.top}`}
						className="blaze-pulse absolute size-[15px] rounded-[3.5px] bg-foreground"
						style={{
							left: cell.left,
							top: cell.top,
							opacity: cell.opacity,
							animationDelay: cell.delay,
						}}
					/>
				))}
			</div>

			{/* Grounding wash, so the field never fights text contrast at the bottom. */}
			<div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-background via-background/60 to-transparent" />
		</div>
	);
}

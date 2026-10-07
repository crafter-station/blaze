import { cn } from "@/lib/utils";

/**
 * blaze brand marks.
 *
 * The isotype is a flame drawn on the same dot-matrix grid as the Doto wordmark, so the
 * two read as one system: 7 columns by 9 rows of round dots, an outer body in the brand
 * fill and a lighter core. Kept as data rather than a path so the favicon generator, the
 * OG image and this component all draw from one definition (`public/logo.svg` is the
 * same grid, rendered).
 */

/** [column, row, isCore] on a 7 x 9 grid. */
export const FLAME_DOTS: ReadonlyArray<readonly [number, number, 0 | 1]> = [
	[4, 0, 0],
	[3, 1, 0],
	[4, 1, 0],
	[2, 2, 0],
	[3, 2, 0],
	[4, 2, 1],
	[1, 3, 0],
	[2, 3, 0],
	[3, 3, 1],
	[4, 3, 1],
	[6, 3, 0],
	[1, 4, 0],
	[2, 4, 1],
	[3, 4, 1],
	[4, 4, 1],
	[5, 4, 0],
	[6, 4, 0],
	[0, 5, 0],
	[1, 5, 0],
	[2, 5, 1],
	[3, 5, 1],
	[4, 5, 1],
	[5, 5, 0],
	[6, 5, 0],
	[0, 6, 0],
	[1, 6, 0],
	[2, 6, 1],
	[3, 6, 1],
	[4, 6, 1],
	[5, 6, 0],
	[6, 6, 0],
	[1, 7, 0],
	[2, 7, 0],
	[3, 7, 1],
	[4, 7, 0],
	[5, 7, 0],
	[2, 8, 0],
	[3, 8, 0],
	[4, 8, 0],
];

export function Isotype({
	className,
	animated = false,
	title,
	bold = false,
}: {
	className?: string;
	/** Flicker the core. Decorative only; stops under prefers-reduced-motion. */
	animated?: boolean;
	title?: string;
	/** Fatter dots for sizes under ~24px, where thin dots antialias into a brown smudge. */
	bold?: boolean;
}) {
	return (
		<svg
			viewBox="0 0 70 90"
			className={cn("h-5 w-auto shrink-0", className)}
			role="img"
			aria-label={title ?? "blaze"}
			aria-hidden={title ? undefined : true}
		>
			<title>{title ?? "blaze"}</title>
			{FLAME_DOTS.map(([x, y, core], index) => (
				<circle
					key={`${x}-${y}`}
					cx={x * 10 + 5}
					cy={y * 10 + 5}
					r={bold ? 4.5 : 3.7}
					className={cn(
						core ? "fill-brand-core" : "fill-brand",
						animated && core && "blaze-flicker",
					)}
					style={animated && core ? { animationDelay: `${-(index % 5) * 0.37}s` } : undefined}
				/>
			))}
		</svg>
	);
}

export function Wordmark({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				"font-bold font-display text-[1.375rem] leading-none tracking-[-0.02em] text-foreground",
				className,
			)}
		>
			blaze
		</span>
	);
}

/** Isotype + wordmark lockup. The isotype is sized to the wordmark's x-height-plus. */
export function Logo({
	className,
	animated,
	size = "md",
}: {
	className?: string;
	animated?: boolean;
	size?: "sm" | "md" | "lg";
}) {
	const iso = { sm: "h-[18px]", md: "h-[22px]", lg: "h-8" }[size];
	const word = { sm: "text-lg", md: "text-[1.375rem]", lg: "text-[2rem]" }[size];

	return (
		<span className={cn("inline-flex items-center gap-2", className)}>
			<Isotype className={iso} animated={animated} bold={size !== "lg"} />
			<Wordmark className={word} />
		</span>
	);
}

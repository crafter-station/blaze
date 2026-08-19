/**
 * blaze's design tokens, mirrored for video.
 *
 * Same values as app/globals.css. Video is where a brand most often drifts — a slightly
 * different black or a different accent reads as a different product — so these are
 * copied verbatim rather than approximated by eye.
 */
export const theme = {
	bg: "#000000",
	card: "#161616",
	popover: "#0b0b0b",
	fg: "#fafafa",
	muted: "#a1a1a1",
	border: "rgba(255,255,255,0.10)",
	primary: "#f8f8f8",
	success: "#5ed3a3",
	warning: "#f0b866",
	destructive: "#ff6568",
	radius: 12,
} as const;

/** 1080p. Scene text is sized for viewing at a distance, not for a desktop reader. */
export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const;

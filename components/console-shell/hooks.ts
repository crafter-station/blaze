"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/** Subscribes to a media query; `false` during SSR so the first paint is the mobile one. */
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		() => window.matchMedia(query).matches,
		() => false,
	);
}

/** Milliseconds since `since`, ticking while `active`. */
export function useElapsed(active: boolean, since: number | null): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => setNow(Date.now()), 100);
		return () => clearInterval(timer);
	}, [active]);
	return active && since ? Math.max(0, now - since) : 0;
}

export function formatMs(ms: number): string {
	if (Number.isInteger(ms) && ms < 1000) return `${ms} ms`;
	if (ms < 1) return `${ms.toFixed(2)} ms`;
	if (ms < 10) return `${ms.toFixed(1)} ms`;
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export const isMacPlatform = () =>
	typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform);

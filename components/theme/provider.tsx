"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Colour mode. System by default, class-based so Tailwind's `dark:` variant and every
 * token in globals.css switch together. Transitions are disabled during the switch so
 * borders and backgrounds do not animate at different speeds and flash.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
	return (
		<NextThemesProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
		>
			{children}
		</NextThemesProvider>
	);
}

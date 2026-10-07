"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

/** Sonner, following the resolved colour mode and drawing from the same tokens. */
export function Toaster() {
	const { resolvedTheme } = useTheme();
	return (
		<Sonner
			theme={resolvedTheme === "light" ? "light" : "dark"}
			position="bottom-right"
			toastOptions={{
				classNames: {
					toast:
						"!rounded-lg !border !border-border !bg-popover !text-popover-foreground !shadow-lg !font-sans",
					description: "!text-muted-foreground",
				},
			}}
		/>
	);
}

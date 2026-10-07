"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const OPTIONS = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
] as const;

/**
 * Three-way segmented control rather than a sun/moon flip: "follow my OS" is a real
 * choice, and a two-state switch has nowhere to put it.
 */
export function ThemeToggle({ className }: { className?: string }) {
	const { theme, setTheme } = useTheme();
	// The resolved theme is unknown on the server; render a neutral state until mounted
	// so the pressed segment never mismatches between server and client HTML.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	return (
		<fieldset
			className={cn(
				"inline-flex items-center gap-0.5 rounded-full border border-border bg-background p-0.5",
				className,
			)}
		>
			<legend className="sr-only">Colour theme</legend>
			{OPTIONS.map((option) => {
				const active = mounted && theme === option.value;
				return (
					<button
						key={option.value}
						type="button"
						onClick={() => setTheme(option.value)}
						aria-pressed={active}
						aria-label={option.label}
						title={option.label}
						className={cn(
							"inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
							active && "bg-accent text-foreground",
						)}
					>
						<option.icon className="size-3.5" strokeWidth={1.75} />
					</button>
				);
			})}
		</fieldset>
	);
}

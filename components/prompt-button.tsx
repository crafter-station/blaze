"use client";

import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The landing page's single action: copy the setup prompt.
 *
 * The prompt itself is hidden because it is long, and length reads as work. What matters
 * is that one click puts it on the clipboard — the reader can inspect it before pasting
 * via the disclosure, but nobody has to scroll a wall of instructions to reach the point.
 *
 * The sparkles are drawn as SVG rather than an emoji so they inherit colour and stroke
 * weight from the design system and stay crisp at any scale. They animate with CSS only,
 * and stop entirely under prefers-reduced-motion.
 */

function Sparkle({ className, style }: { className?: string; style?: React.CSSProperties }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={className}
			style={style}
			fill="currentColor"
		>
			<title>sparkle</title>
			<path d="M12 0c.5 6.2 5.3 11 11.5 11.5C17.3 12 12.5 16.8 12 23c-.5-6.2-5.3-11-11.5-11.5C6.7 11 11.5 6.2 12 0Z" />
		</svg>
	);
}

export function PromptButton({ prompt }: { prompt: string }) {
	const [copied, setCopied] = useState(false);
	const [open, setOpen] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(prompt);
			setCopied(true);
			setTimeout(() => setCopied(false), 2200);
		} catch {
			// Clipboard is unavailable on insecure origins; the disclosure below is the fallback.
			setOpen(true);
		}
	}

	return (
		<div className="flex flex-col items-start gap-3">
			<div className="relative inline-flex">
				{/* Sparkles sit above the button and are decorative only. */}
				<Sparkle className="blaze-sparkle -top-3 -left-2 absolute size-4 text-foreground" />
				<Sparkle
					className="blaze-sparkle -top-1.5 absolute right-3 size-2.5 text-foreground"
					style={{ animationDelay: "-1.1s" }}
				/>
				<Sparkle
					className="blaze-sparkle -top-4 absolute left-1/2 size-2 text-foreground"
					style={{ animationDelay: "-2.3s" }}
				/>

				<button
					type="button"
					onClick={copy}
					className="inline-flex items-center gap-2.5 rounded-lg bg-primary px-5 py-3 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
				>
					{copied ? <Check className="size-4" /> : <Sparkle className="size-4 shrink-0" />}
					{copied ? "Copied — paste it into your agent" : "Copy the setup prompt"}
				</button>
			</div>

			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="inline-flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
			>
				<ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
				{open ? "Hide it" : "See what it says"}
			</button>

			{open && (
				<pre className="max-h-52 w-full max-w-2xl overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-card/80 px-4 py-3 text-[12px] text-muted-foreground leading-relaxed backdrop-blur">
					{prompt}
				</pre>
			)}
		</div>
	);
}

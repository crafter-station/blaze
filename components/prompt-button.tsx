"use client";

import { Check, ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Copy the paste-into-your-agent setup prompt.
 *
 * The prompt itself stays folded because it is long, and length reads as work. One click
 * puts it on the clipboard; the disclosure lets anyone read it before pasting.
 */
export function PromptButton({
	prompt,
	className,
	size = "xl",
}: {
	prompt: string;
	className?: string;
	size?: "lg" | "xl";
}) {
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
		<div className={cn("flex flex-col items-start gap-3", className)}>
			<Button type="button" variant="outline" size={size} onClick={copy}>
				{copied ? (
					<Check className="text-success" data-icon="inline-start" />
				) : (
					<Copy data-icon="inline-start" />
				)}
				<span aria-live="polite">
					{copied ? "Copied. Paste it into your agent" : "Copy setup prompt"}
				</span>
			</Button>

			<button
				type="button"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				className="inline-flex items-center gap-1 rounded-sm text-muted-foreground text-xs transition-colors hover:text-foreground"
			>
				<ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
				{open ? "Hide the prompt" : "Read the prompt first"}
			</button>

			{open && (
				<pre className="max-h-64 w-full overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-[var(--code-background)] px-4 py-3 text-[0.75rem] text-muted-foreground leading-relaxed">
					{prompt}
				</pre>
			)}
		</div>
	);
}

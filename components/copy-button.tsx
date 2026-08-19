"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Copy affordance for code and prompt blocks.
 *
 * Deliberately a small client island rather than making whole pages client components:
 * the docs and landing page are static server-rendered content, and clipboard access is
 * the only thing on them that needs JavaScript at all.
 */
export function CopyButton({
	value,
	label = "Copy",
	className,
}: {
	value: string;
	label?: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
		} catch {
			// Clipboard is blocked on insecure origins and in some embedded browsers. The
			// text is always visible and selectable, so failing quietly is right here.
		}
	}

	return (
		<button
			type="button"
			onClick={copy}
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground",
				className,
			)}
		>
			{copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
			{copied ? "Copied" : label}
		</button>
	);
}

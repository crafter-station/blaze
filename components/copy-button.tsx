"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Copy affordance for code and prompt blocks.
 *
 * A small client island rather than making whole pages client components: the docs and
 * landing page are static server-rendered content, and clipboard access is the only thing
 * on them that needs JavaScript at all.
 */
export function CopyButton({
	value,
	label = "Copy",
	className,
	iconOnly = false,
}: {
	value: string;
	label?: string;
	className?: string;
	iconOnly?: boolean;
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

	const icon = copied ? (
		<Check className="text-success" data-icon="inline-start" />
	) : (
		<Copy data-icon="inline-start" />
	);

	if (iconOnly) {
		return (
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				onClick={copy}
				aria-label={copied ? "Copied" : label}
				className={className}
			>
				{icon}
			</Button>
		);
	}

	return (
		<Button
			type="button"
			variant="ghost"
			size="xs"
			onClick={copy}
			className={cn("text-muted-foreground", className)}
		>
			{icon}
			<span aria-live="polite">{copied ? "Copied" : label}</span>
		</Button>
	);
}

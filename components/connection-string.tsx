"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

/**
 * Masked by default. The password is the whole secret, and these strings get shown in
 * screenshares and screenshots far more often than they get typed.
 */
export function ConnectionString({ value, masked }: { value: string; masked: string }) {
	const [revealed, setRevealed] = useState(false);
	const [copied, setCopied] = useState(false);

	async function copy() {
		await navigator.clipboard.writeText(value);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}

	return (
		<div className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
			<code className="flex-1 overflow-x-auto whitespace-nowrap text-muted-foreground text-xs">
				{revealed ? value : masked}
			</code>
			<button
				type="button"
				onClick={() => setRevealed(!revealed)}
				className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label={revealed ? "Hide password" : "Reveal password"}
			>
				{revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
			</button>
			<button
				type="button"
				onClick={copy}
				className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="Copy connection string"
			>
				{copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
			</button>
		</div>
	);
}

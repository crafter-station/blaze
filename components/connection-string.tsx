"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

/**
 * Connection details block, matching Neon's: labelled box, monospace string, reveal and
 * copy affordances on the right.
 *
 * Masked by default — the password is the whole secret, and these strings end up in
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
		<div className="rounded-lg border border-border bg-background p-4">
			<p className="mb-2 text-muted-foreground text-xs">Connection string</p>
			<div className="flex items-center gap-3">
				<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[13px] text-foreground/90">
					{revealed ? value : masked}
				</code>
				<div className="flex shrink-0 items-center gap-2">
					<button
						type="button"
						onClick={() => setRevealed(!revealed)}
						className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						aria-label={revealed ? "Hide password" : "Reveal password"}
					>
						{revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
					</button>
					<button
						type="button"
						onClick={copy}
						className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground"
					>
						{copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
			</div>
		</div>
	);
}

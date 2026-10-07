"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Connection details field: monospace string with reveal and copy on the right.
 *
 * Masked by default: the password is the whole secret, and these strings end up in
 * screenshares and screenshots far more often than they get typed.
 */
export function ConnectionString({
	value,
	masked,
	label = "Connection string",
	className,
}: {
	value: string;
	masked: string;
	label?: string;
	className?: string;
}) {
	const [revealed, setRevealed] = useState(false);
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {}
	}

	return (
		<div className={cn("min-w-0", className)}>
			{label && <p className="mb-1.5 text-muted-foreground text-xs">{label}</p>}
			<div className="flex h-10 items-center gap-1 rounded-md border border-border bg-background pr-1 pl-3 shadow-xs">
				<code className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[0.8125rem] text-foreground/90">
					{revealed ? value : masked}
				</code>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setRevealed(!revealed)}
							aria-label={revealed ? "Hide password" : "Reveal password"}
						>
							{revealed ? <EyeOff /> : <Eye />}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{revealed ? "Hide password" : "Reveal password"}</TooltipContent>
				</Tooltip>
				<Button variant="outline" size="sm" onClick={copy} className="min-w-[76px]">
					{copied ? <Check className="text-success" /> : <Copy />}
					<span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
				</Button>
			</div>
		</div>
	);
}

import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/** Labelled, copyable code sample. Server-rendered; only the copy button hydrates. */
export function CodeBlock({
	code,
	label,
	className,
	wrap = false,
}: {
	code: string;
	label?: React.ReactNode;
	className?: string;
	wrap?: boolean;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-lg border border-border bg-[var(--code-background)]",
				className,
			)}
		>
			<div className="flex h-9 items-center justify-between gap-3 border-border border-b pr-1.5 pl-3.5">
				<span className="truncate font-mono text-[0.75rem] text-muted-foreground">
					{label ?? "Example"}
				</span>
				<CopyButton value={code} />
			</div>
			<pre
				className={cn(
					"overflow-x-auto px-3.5 py-3 text-[0.8125rem] leading-relaxed",
					wrap && "whitespace-pre-wrap",
				)}
			>
				{code}
			</pre>
		</div>
	);
}

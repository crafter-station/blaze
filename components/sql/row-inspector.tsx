"use client";

import { ChevronDown, ChevronUp, ClipboardCopy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fullCell } from "@/lib/sql/cells";
import { cellToText, toJsonRows } from "@/lib/sql/export";
import type { ResultColumn } from "@/lib/sql/types";
import { cn } from "@/lib/utils";

/**
 * One row, every column, values in full: long text wrapped, JSON pretty-printed, NULL
 * distinct from the string "NULL". Read-only by design; editing rows belongs to the table
 * browser.
 */
export function RowInspector({
	columns,
	row,
	index,
	total,
	onPrev,
	onNext,
	onClose,
	className,
}: {
	columns: ResultColumn[];
	row: unknown[];
	index: number;
	total: number;
	onPrev: () => void;
	onNext: () => void;
	onClose: () => void;
	className?: string;
}) {
	async function copy(text: string, what: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`Copied ${what}`);
		} catch {
			toast.error("Clipboard is not available");
		}
	}

	return (
		<div className={cn("flex min-h-0 flex-col", className)}>
			<div className="flex h-10 shrink-0 items-center gap-1 border-border border-b pr-1.5 pl-3">
				<p className="mr-auto font-medium text-[0.8125rem]">
					Row <span className="tabular-nums">{index + 1}</span>
					<span className="font-normal text-muted-foreground tabular-nums"> of {total}</span>
				</p>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onPrev}
					disabled={index === 0}
					aria-label="Previous row"
				>
					<ChevronUp />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onNext}
					disabled={index >= total - 1}
					aria-label="Next row"
				>
					<ChevronDown />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={() =>
						void copy(JSON.stringify(toJsonRows(columns, [row])[0], null, 2), "row as JSON")
					}
					aria-label="Copy row as JSON"
					title="Copy row as JSON"
				>
					<ClipboardCopy />
				</Button>
				<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspector">
					<X />
				</Button>
			</div>
			<dl className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
				{columns.map((column, i) => {
					const value = row[i];
					const isNull = value === null || value === undefined;
					return (
						<div key={`${column.name}-${i}`} className="group/field px-3 py-2.5">
							<dt className="flex items-center gap-2">
								<span className="truncate font-medium font-mono text-xs">{column.name}</span>
								{column.type && (
									<span className="truncate font-mono text-[0.625rem] text-muted-foreground">
										{column.type.toLowerCase()}
									</span>
								)}
								<button
									type="button"
									onClick={() => void copy(cellToText(value), column.name)}
									aria-label={`Copy ${column.name}`}
									className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/field:opacity-100 pointer-coarse:opacity-100"
								>
									<ClipboardCopy className="size-3" />
								</button>
							</dt>
							<dd
								className={cn(
									"mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.75rem] leading-relaxed",
									isNull ? "text-muted-foreground/60 italic" : "text-foreground/90",
								)}
							>
								{fullCell(value)}
							</dd>
						</div>
					);
				})}
			</dl>
		</div>
	);
}

"use client";

import { CheckCircle2, CircleAlert, History, type LucideIcon, Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Side-panel lists shared by the consoles: a filter box, empty and loading states, and
 * the run history. Opening an entry hands its text back to the console; nothing here runs
 * anything by itself.
 */

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(at: number): string {
	const seconds = Math.round((at - Date.now()) / 1000);
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		["day", 86_400],
		["hour", 3_600],
		["minute", 60],
	];
	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
	}
	return "just now";
}

export function preview(text: string) {
	return text.replace(/\s+/g, " ").trim().slice(0, 140);
}

export function ListFilter({
	value,
	onChange,
	label,
}: {
	value: string;
	onChange: (v: string) => void;
	label: string;
}) {
	return (
		<div className="shrink-0 p-2">
			<label className="relative block">
				<span className="sr-only">{label}</span>
				<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<input
					type="search"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={`${label}…`}
					spellCheck={false}
					autoComplete="off"
					className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 text-[0.8125rem] outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
				/>
			</label>
		</div>
	);
}

export function ListEmpty({
	icon: Icon,
	title,
	children,
}: {
	icon: LucideIcon;
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="px-4 py-10 text-center">
			<Icon className="mx-auto size-5 text-muted-foreground" strokeWidth={1.5} />
			<p className="mt-2 font-medium text-[0.8125rem]">{title}</p>
			<p className="mt-1 text-muted-foreground text-xs leading-relaxed">{children}</p>
		</div>
	);
}

export function ListSkeleton() {
	return (
		<div className="space-y-3 px-2.5 py-2" aria-hidden="true">
			{[70, 55, 62].map((width, i) => (
				<div key={i} className="space-y-1.5">
					<div
						className="h-3 animate-pulse rounded bg-foreground/[0.07] motion-reduce:animate-none"
						style={{ width: `${width}%` }}
					/>
					<div className="h-2.5 w-11/12 animate-pulse rounded bg-foreground/[0.05] motion-reduce:animate-none" />
				</div>
			))}
		</div>
	);
}

export interface HistoryListItem {
	id: string;
	/** The run's text: SQL or commands. */
	text: string;
	at: number;
	ok: boolean;
	/** Right-aligned summary, e.g. `3 stmts · 12 rows · 4 ms`. */
	meta: string;
	error?: string;
}

export function HistoryList({
	entries,
	onOpen,
	onClear,
	emptyHint,
}: {
	entries: HistoryListItem[];
	onOpen: (entry: HistoryListItem) => void;
	onClear: () => void;
	emptyHint: string;
}) {
	const [filter, setFilter] = useState("");
	const list = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		return entries.filter((e) => !needle || e.text.toLowerCase().includes(needle));
	}, [entries, filter]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ListFilter value={filter} onChange={setFilter} label="Filter history" />
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
				{entries.length === 0 ? (
					<ListEmpty icon={History} title="No history yet">
						{emptyHint}
					</ListEmpty>
				) : list.length === 0 ? (
					<p className="px-3 py-6 text-center text-muted-foreground text-xs">Nothing matches.</p>
				) : (
					<ul className="space-y-px">
						{list.map((entry) => (
							<li key={entry.id}>
								<button
									type="button"
									onClick={() => onOpen(entry)}
									title={entry.error ?? undefined}
									className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
								>
									<span className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
										{entry.ok ? (
											<CheckCircle2 className="size-3" aria-label="Succeeded" />
										) : (
											<CircleAlert className="size-3 text-destructive" aria-label="Failed" />
										)}
										<span>{timeAgo(entry.at)}</span>
										<span className="ml-auto font-mono tabular-nums">{entry.meta}</span>
									</span>
									<span className="mt-1 line-clamp-2 break-all font-mono text-[0.6875rem] text-foreground/85">
										{preview(entry.text)}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
			{entries.length > 0 && (
				<div className="shrink-0 border-border border-t p-2">
					<Button variant="ghost" size="xs" className="w-full" onClick={onClear}>
						Clear history
					</Button>
				</div>
			)}
		</div>
	);
}

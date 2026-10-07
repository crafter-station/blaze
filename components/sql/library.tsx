"use client";

import {
	Bookmark,
	CheckCircle2,
	CircleAlert,
	ClipboardCopy,
	History,
	MoreHorizontal,
	Pencil,
	Search,
	Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SavedQueryView } from "@/lib/saved-queries";
import { cn } from "@/lib/utils";
import type { HistoryEntry } from "./history";
import { formatMs } from "./hooks";

/**
 * Saved queries and run history, listed in the side panel next to the schema.
 * Opening either puts the SQL in a new tab; nothing here runs anything by itself.
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

function preview(sql: string) {
	return sql.replace(/\s+/g, " ").trim().slice(0, 140);
}

function Filter({
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

function Empty({
	icon: Icon,
	title,
	children,
}: {
	icon: typeof Bookmark;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="px-4 py-10 text-center">
			<Icon className="mx-auto size-5 text-muted-foreground" strokeWidth={1.5} />
			<p className="mt-2 font-medium text-[0.8125rem]">{title}</p>
			<p className="mt-1 text-muted-foreground text-xs leading-relaxed">{children}</p>
		</div>
	);
}

export function SavedQueries({
	queries,
	loading,
	error,
	activeSavedId,
	onOpen,
	onRename,
	onDelete,
	saveHint,
}: {
	queries: SavedQueryView[] | null;
	loading: boolean;
	error: string | null;
	activeSavedId?: string;
	onOpen: (query: SavedQueryView) => void;
	onRename: (query: SavedQueryView) => void;
	onDelete: (query: SavedQueryView) => void;
	saveHint: string;
}) {
	const [filter, setFilter] = useState("");
	const list = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		return (queries ?? []).filter(
			(q) =>
				!needle || q.name.toLowerCase().includes(needle) || q.sql.toLowerCase().includes(needle),
		);
	}, [queries, filter]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<Filter value={filter} onChange={setFilter} label="Filter saved queries" />
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-3">
				{error ? (
					<p role="alert" className="px-3 py-4 text-destructive text-xs">
						{error}
					</p>
				) : !queries ? (
					loading ? (
						<ListSkeleton />
					) : null
				) : queries.length === 0 ? (
					<Empty icon={Bookmark} title="No saved queries">
						Press {saveHint} in the editor to keep a query for later.
					</Empty>
				) : list.length === 0 ? (
					<p className="px-3 py-6 text-center text-muted-foreground text-xs">Nothing matches.</p>
				) : (
					<ul className="space-y-px">
						{list.map((query) => (
							<li key={query.id} className="group/item relative">
								<button
									type="button"
									onClick={() => onOpen(query)}
									className={cn(
										"block w-full rounded-md px-2.5 py-2 pr-8 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring",
										activeSavedId === query.id && "bg-accent",
									)}
								>
									<span className="block truncate font-medium text-[0.8125rem]">{query.name}</span>
									<span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-muted-foreground">
										{preview(query.sql)}
									</span>
									<span className="mt-0.5 block text-[0.6875rem] text-muted-foreground/80">
										{timeAgo(new Date(query.updatedAt).getTime())}
									</span>
								</button>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											aria-label={`Actions for ${query.name}`}
											className="absolute top-2 right-1.5 flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/item:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
										>
											<MoreHorizontal className="size-3.5" />
										</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onSelect={() => onRename(query)}>
											<Pencil className="text-muted-foreground" />
											Rename
										</DropdownMenuItem>
										<DropdownMenuItem
											onSelect={async () => {
												try {
													await navigator.clipboard.writeText(query.sql);
													toast.success("Copied SQL");
												} catch {
													toast.error("Clipboard is not available");
												}
											}}
										>
											<ClipboardCopy className="text-muted-foreground" />
											Copy SQL
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem variant="destructive" onSelect={() => onDelete(query)}>
											<Trash2 />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

export function QueryHistory({
	entries,
	onOpen,
	onClear,
}: {
	entries: HistoryEntry[];
	onOpen: (entry: HistoryEntry) => void;
	onClear: () => void;
}) {
	const [filter, setFilter] = useState("");
	const list = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		return entries.filter((e) => !needle || e.sql.toLowerCase().includes(needle));
	}, [entries, filter]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<Filter value={filter} onChange={setFilter} label="Filter history" />
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
				{entries.length === 0 ? (
					<Empty icon={History} title="No history yet">
						Queries you run on this database show up here. They stay in this browser only.
					</Empty>
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
										<span className="ml-auto font-mono tabular-nums">
											{entry.statements > 1 ? `${entry.statements} stmts · ` : ""}
											{typeof entry.rows === "number" ? `${entry.rows} rows · ` : ""}
											{formatMs(entry.durationMs)}
										</span>
									</span>
									<span className="mt-1 line-clamp-2 break-all font-mono text-[0.6875rem] text-foreground/85">
										{preview(entry.sql)}
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

function ListSkeleton() {
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

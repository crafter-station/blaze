"use client";

import { Bookmark, ClipboardCopy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatMs } from "@/components/console-shell/hooks";
import {
	HistoryList,
	ListEmpty,
	ListFilter,
	ListSkeleton,
	preview,
	timeAgo,
} from "@/components/console-shell/library";
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

/**
 * Saved queries and run history, listed in the side panel next to the schema.
 * Opening either puts the SQL in a new tab; nothing here runs anything by itself.
 */

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
			<ListFilter value={filter} onChange={setFilter} label="Filter saved queries" />
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
					<ListEmpty icon={Bookmark} title="No saved queries">
						Press {saveHint} in the editor to keep a query for later.
					</ListEmpty>
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
	const items = useMemo(
		() =>
			entries.map((entry) => ({
				id: entry.id,
				text: entry.sql,
				at: entry.at,
				ok: entry.ok,
				error: entry.error,
				meta: `${entry.statements > 1 ? `${entry.statements} stmts · ` : ""}${typeof entry.rows === "number" ? `${entry.rows} rows · ` : ""}${formatMs(entry.durationMs)}`,
			})),
		[entries],
	);
	return (
		<HistoryList
			entries={items}
			onOpen={(item) => {
				const entry = entries.find((e) => e.id === item.id);
				if (entry) onOpen(entry);
			}}
			onClear={onClear}
			emptyHint="Queries you run on this database show up here. They stay in this browser only."
		/>
	);
}

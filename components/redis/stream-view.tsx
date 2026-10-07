"use client";

import { ChevronLeft, ChevronRight, Loader2, Users } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { DataGrid } from "@/components/console-shell/data-grid";
import { SegmentedTabs } from "@/components/console-shell/tab-strip";
import { Button } from "@/components/ui/button";
import type { KeyValue, ValuePage } from "@/lib/redis/types";
import { cn } from "@/lib/utils";
import type { RowAction } from "./value-view";

/**
 * A stream: its entries newest first in the shared grid (one column per field name seen
 * on the page), paged backwards by id with XREVRANGE, and a summary of its consumer
 * groups (XINFO GROUPS): consumers, pending entries, last delivered id and lag.
 */

type Stream = Extract<KeyValue, { kind: "stream" }>;

/** Entry ids start with a millisecond timestamp. */
export function idTime(id: string): string {
	const ms = Number(id.split("-")[0]);
	if (!Number.isFinite(ms)) return "";
	return new Date(ms)
		.toISOString()
		.replace("T", " ")
		.replace(/\.\d+Z$/, "Z");
}

export function StreamValue({
	value,
	label,
	loading,
	onPage,
	rowAction,
	toolbar,
}: {
	value: Stream;
	label: string;
	loading: boolean;
	onPage: (page: ValuePage, append: boolean) => void;
	rowAction?: RowAction;
	toolbar?: ReactNode;
}) {
	const [tab, setTab] = useState<"entries" | "groups">("entries");
	// Ids each newer page started before, so "Newer" can walk back.
	const [history, setHistory] = useState<(string | undefined)[]>([]);

	const grid = useMemo(() => {
		const fields: string[] = [];
		for (const entry of value.entries) {
			for (const [name] of entry.fields) {
				if (!fields.includes(name) && fields.length < 16) fields.push(name);
			}
		}
		return {
			columns: [{ name: "id" }, { name: "time" }, ...fields.map((name) => ({ name }))],
			rows: value.entries.map((entry) => {
				const map = new Map(entry.fields);
				return [entry.id, idTime(entry.id), ...fields.map((name) => map.get(name) ?? null)];
			}),
		};
	}, [value.entries]);

	const first = value.entries[0]?.id;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-2">
				<SegmentedTabs
					items={[
						{ id: "entries" as const, label: "Entries" },
						{
							id: "groups" as const,
							label: `Consumer groups (${value.groups.length})`,
							icon: Users,
						},
					]}
					value={tab}
					onChange={setTab}
					label="Stream view"
					className="w-auto [&>button]:px-2.5"
				/>
				<div className="ml-auto flex items-center gap-1">{toolbar}</div>
			</div>

			{tab === "entries" ? (
				<>
					<div className={cn("flex min-h-0 flex-1 transition-opacity", loading && "opacity-60")}>
						<DataGrid
							key={first ?? "empty"}
							columns={grid.columns}
							rows={grid.rows}
							onInspect={(index) => rowAction?.run(index)}
							inspectedRow={null}
							label={label}
							inspectLabel={rowAction?.label ?? "Inspect row"}
							emptyLabel="No entries"
						/>
					</div>
					<footer className="flex h-9 shrink-0 items-center gap-2 border-border border-t px-3 text-[0.6875rem] text-muted-foreground">
						<span className="truncate tabular-nums">
							{value.entries.length.toLocaleString()} of {value.length.toLocaleString()} entries,
							newest first
							{value.firstId && value.lastId && (
								<span className="hidden sm:inline">
									{" "}
									· ids {value.firstId} to {value.lastId}
								</span>
							)}
						</span>
						<div className="ml-auto flex items-center gap-1">
							{loading && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />}
							<Button
								variant="ghost"
								size="xs"
								disabled={history.length === 0 || loading}
								onClick={() => {
									const previous = history.at(-1);
									setHistory((h) => h.slice(0, -1));
									onPage(previous ? { before: previous } : {}, false);
								}}
							>
								<ChevronLeft data-icon="inline-start" />
								Newer
							</Button>
							<Button
								variant="ghost"
								size="xs"
								disabled={!value.before || loading}
								onClick={() => {
									if (!value.before) return;
									// Remember where this page started so Newer can come back to it.
									setHistory((h) => [
										...h,
										value.entries.length ? `${bump(value.entries[0].id)}` : undefined,
									]);
									onPage({ before: value.before }, false);
								}}
							>
								Older
								<ChevronRight data-icon="inline-end" />
							</Button>
						</div>
					</footer>
				</>
			) : (
				<Groups value={value} />
			)}
		</div>
	);
}

/** The id just after `id`, so an exclusive "before" bound includes `id` itself. */
function bump(id: string): string {
	const [ms, seq] = id.split("-").map((part) => BigInt(part));
	return `${ms}-${seq + BigInt(1)}`;
}

function Groups({ value }: { value: Stream }) {
	if (value.groups.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center p-10 text-center">
				<div>
					<Users className="mx-auto size-5 text-muted-foreground" strokeWidth={1.5} />
					<p className="mt-2 font-medium text-sm">No consumer groups</p>
					<p className="mt-1 max-w-xs text-muted-foreground text-xs leading-relaxed">
						Create one with XGROUP CREATE in the console to read this stream with acknowledgements.
					</p>
				</div>
			</div>
		);
	}
	return (
		<div className="min-h-0 flex-1 overflow-auto">
			<table className="w-full min-w-[560px] text-left text-[0.8125rem]">
				<thead className="sticky top-0 bg-card text-muted-foreground text-xs">
					<tr className="border-border border-b">
						<th className="px-4 py-2 font-medium">Group</th>
						<th className="px-4 py-2 text-right font-medium">Consumers</th>
						<th className="px-4 py-2 text-right font-medium">Pending</th>
						<th className="px-4 py-2 font-medium">Last delivered</th>
						<th className="px-4 py-2 text-right font-medium">Lag</th>
					</tr>
				</thead>
				<tbody className="font-mono text-[0.75rem]">
					{value.groups.map((group) => (
						<tr key={group.name} className="border-border/70 border-b">
							<td className="px-4 py-2 font-medium">{group.name}</td>
							<td className="px-4 py-2 text-right tabular-nums">{group.consumers}</td>
							<td
								className={cn(
									"px-4 py-2 text-right tabular-nums",
									group.pending > 0 && "text-warning",
								)}
							>
								{group.pending.toLocaleString()}
							</td>
							<td className="px-4 py-2 text-muted-foreground">
								{group.lastDeliveredId}
								<span className="ml-2 hidden font-sans text-[0.6875rem] lg:inline">
									{idTime(group.lastDeliveredId)}
								</span>
							</td>
							<td className="px-4 py-2 text-right tabular-nums">
								{group.lag === null ? "unknown" : group.lag.toLocaleString()}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="px-4 py-3 text-muted-foreground text-xs leading-relaxed">
				Pending entries were delivered to a consumer and not yet acknowledged (XACK). Lag is how
				many entries the group has not read yet. XINFO CONSUMERS in the console lists each consumer.
			</p>
		</div>
	);
}

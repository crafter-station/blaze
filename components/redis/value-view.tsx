"use client";

import {
	Binary,
	Braces,
	ChevronLeft,
	ChevronRight,
	ClipboardCopy,
	FileQuestion,
	Loader2,
	SquareTerminal,
	Type,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { DataGrid } from "@/components/console-shell/data-grid";
import { SegmentedTabs } from "@/components/console-shell/tab-strip";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { typeLabel } from "@/lib/redis/keys";
import type { KeyDetails, KeyValue, ValuePage, ValueText } from "@/lib/redis/types";
import { hexDump, prettyJson } from "@/lib/redis/value";
import { cn } from "@/lib/utils";

/**
 * The value of one key, by type: strings as text, JSON or a hex dump; lists, hashes, sets
 * and sorted sets in the shared data grid; module types (time series, Bloom filters...)
 * as a pointer to the console, which has their commands.
 *
 * Editing hooks in through `rowActions`: a viewer that receives one offers it on the
 * grid's row action (double-click, Enter, context menu).
 */

export interface RowAction {
	label: string;
	/** Index into the rows the viewer was given. */
	run: (index: number) => void;
}

export function displayValue(value: ValueText): string {
	return value.truncated ? `${value.text}…` : value.text;
}

export async function copyText(text: string, what: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast.success(`Copied ${what}`);
	} catch {
		toast.error("Clipboard is not available");
	}
}

/* ------------------------------------------------------------------ *
 * Strings
 * ------------------------------------------------------------------ */

type StringMode = "text" | "json" | "hex";

export function StringValue({ value, toolbar }: { value: ValueText; toolbar?: ReactNode }) {
	const json = useMemo(
		() => (value.binary || value.truncated ? null : prettyJson(value.text)),
		[value],
	);
	const modes = [
		{ id: "text" as const, label: value.binary ? "Escaped" : "Text", icon: Type },
		...(json ? [{ id: "json" as const, label: "JSON", icon: Braces }] : []),
		...(value.binary ? [{ id: "hex" as const, label: "Hex", icon: Binary }] : []),
	];
	const [mode, setMode] = useState<StringMode>(json ? "json" : value.binary ? "hex" : "text");
	const active = modes.some((m) => m.id === mode) ? mode : "text";

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-3">
				{modes.length > 1 && (
					<SegmentedTabs
						items={modes}
						value={active}
						onChange={setMode}
						label="Show value as"
						className="w-auto"
					/>
				)}
				<span className="text-[0.6875rem] text-muted-foreground tabular-nums">
					{formatBytes(value.bytes)}
					{value.binary && " · binary"}
					{value.truncated && " · showing the first part"}
				</span>
				<div className="ml-auto flex items-center gap-1">
					{toolbar}
					<Button
						variant="ghost"
						size="xs"
						onClick={() => void copyText(active === "json" && json ? json : value.text, "value")}
						disabled={value.truncated}
						title={
							value.truncated ? "Too large to copy from here; use GET in the console" : "Copy value"
						}
					>
						<ClipboardCopy data-icon="inline-start" />
						Copy
					</Button>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-auto bg-[var(--code-background)]">
				{active === "hex" && value.hex ? (
					<HexDump hex={value.hex} />
				) : (
					<pre
						translate="no"
						className="whitespace-pre-wrap break-all px-4 py-3 font-mono text-[0.8125rem] leading-relaxed"
					>
						{active === "json" && json ? <JsonText text={json} /> : displayValue(value)}
					</pre>
				)}
			</div>
		</div>
	);
}

/** Minimal JSON colouring: keys in the foreground, strings in brand text, the rest muted. */
export function JsonText({ text }: { text: string }) {
	const parts = text.split(
		/("(?:\\.|[^"\\])*"\s*:?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
	);
	return (
		<>
			{parts.map((part, i) => {
				if (!part) return null;
				if (part.startsWith('"')) {
					return part.trimEnd().endsWith(":") ? (
						<span key={i} className="text-foreground">
							{part}
						</span>
					) : (
						<span key={i} className="text-brand-text">
							{part}
						</span>
					);
				}
				if (/^(true|false|null|-?\d)/.test(part)) {
					return (
						<span key={i} className="text-[var(--type-string)]">
							{part}
						</span>
					);
				}
				return (
					<span key={i} className="text-muted-foreground">
						{part}
					</span>
				);
			})}
		</>
	);
}

function HexDump({ hex }: { hex: string }) {
	const rows = useMemo(() => hexDump(hex), [hex]);
	return (
		<table className="w-max px-4 py-3 font-mono text-[0.75rem] leading-relaxed" translate="no">
			<caption className="sr-only">Hex dump: offset, bytes, ASCII</caption>
			<tbody>
				{rows.map((row) => (
					<tr key={row.offset}>
						<td className="select-none py-px pr-4 pl-4 text-muted-foreground/70">{row.offset}</td>
						<td className="py-px pr-4 whitespace-pre">{row.hex.padEnd(47, " ")}</td>
						<td className="py-px pr-4 text-muted-foreground">{row.ascii}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/* ------------------------------------------------------------------ *
 * Collections in the shared grid
 * ------------------------------------------------------------------ */

function Pager({
	from,
	count,
	total,
	onPrev,
	onNext,
	onMore,
	loading,
	note,
}: {
	from?: number;
	count: number;
	total: number;
	onPrev?: () => void;
	onNext?: () => void;
	onMore?: () => void;
	loading?: boolean;
	note?: ReactNode;
}) {
	return (
		<footer className="flex h-9 shrink-0 items-center gap-2 border-border border-t px-3 text-[0.6875rem] text-muted-foreground">
			<span className="tabular-nums">
				{from !== undefined
					? count === 0
						? `0 of ${total.toLocaleString()}`
						: `${(from + 1).toLocaleString()}-${(from + count).toLocaleString()} of ${total.toLocaleString()}`
					: `${count.toLocaleString()} of ${total.toLocaleString()} loaded`}
			</span>
			{note}
			<div className="ml-auto flex items-center gap-1">
				{loading && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />}
				{onMore && (
					<Button variant="ghost" size="xs" onClick={onMore} disabled={loading}>
						Load more
					</Button>
				)}
				{(onPrev || onNext) && (
					<>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={onPrev}
							disabled={!onPrev || loading}
							aria-label="Previous page"
						>
							<ChevronLeft />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={onNext}
							disabled={!onNext || loading}
							aria-label="Next page"
						>
							<ChevronRight />
						</Button>
					</>
				)}
			</div>
		</footer>
	);
}

const PAGE = 200;

export function CollectionValue({
	value,
	label,
	loading,
	onPage,
	rowAction,
	toolbar,
}: {
	value: Extract<KeyValue, { kind: "list" | "hash" | "set" | "zset" }>;
	label: string;
	loading: boolean;
	onPage: (page: ValuePage, append: boolean) => void;
	rowAction?: RowAction;
	toolbar?: ReactNode;
}) {
	const grid = useMemo(() => {
		switch (value.kind) {
			case "list":
				return {
					columns: [{ name: "index" }, { name: "value" }],
					rows: value.items.map((item) => [item.index, displayValue(item.value)]),
				};
			case "hash":
				return {
					columns: [{ name: "field" }, { name: "value" }],
					rows: value.entries.map((entry) => [
						displayValue(entry.field),
						displayValue(entry.value),
					]),
				};
			case "set":
				return {
					columns: [{ name: "member" }],
					rows: value.members.map((member) => [displayValue(member)]),
				};
			case "zset":
				return {
					columns: [{ name: "rank" }, { name: "member" }, { name: "score" }],
					rows: value.members.map((m) => [
						m.rank,
						displayValue(m.member),
						Number.isFinite(Number(m.score)) ? Number(m.score) : m.score,
					]),
				};
		}
	}, [value]);

	const pager =
		value.kind === "list" || value.kind === "zset" ? (
			<Pager
				from={value.offset}
				count={grid.rows.length}
				total={value.total}
				loading={loading}
				onPrev={
					value.offset > 0
						? () => onPage({ offset: Math.max(0, value.offset - PAGE) }, false)
						: undefined
				}
				onNext={
					value.offset + PAGE < value.total
						? () => onPage({ offset: value.offset + PAGE }, false)
						: undefined
				}
			/>
		) : (
			<Pager
				count={grid.rows.length}
				total={value.total}
				loading={loading}
				onMore={value.cursor !== "0" ? () => onPage({ cursor: value.cursor }, true) : undefined}
			/>
		);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{toolbar && (
				<div className="flex h-10 shrink-0 items-center gap-1 border-border border-b px-2">
					{toolbar}
				</div>
			)}
			<div className={cn("flex min-h-0 flex-1 transition-opacity", loading && "opacity-60")}>
				<DataGrid
					key={value.kind === "list" || value.kind === "zset" ? value.offset : "scan"}
					columns={grid.columns}
					rows={grid.rows}
					onInspect={(index) => rowAction?.run(index)}
					inspectedRow={null}
					label={label}
					inspectLabel={rowAction?.label ?? "Inspect row"}
					emptyLabel="Empty"
				/>
			</div>
			{pager}
		</div>
	);
}

/* ------------------------------------------------------------------ *
 * Types the browser does not render itself
 * ------------------------------------------------------------------ */

export function RawValue({
	type,
	command,
	databaseId,
	note,
}: {
	type: string;
	command: string;
	databaseId: string;
	note?: string;
}) {
	return (
		<div className="flex flex-1 items-start justify-center overflow-auto p-6 sm:p-10">
			<div className="w-full max-w-md rounded-xl border border-border bg-background/50 p-5">
				<FileQuestion className="size-5 text-muted-foreground" strokeWidth={1.5} />
				<p className="mt-3 font-medium text-sm">{typeLabel(type)} values open in the console</p>
				<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
					{note ??
						`The browser does not render ${typeLabel(type).toLowerCase()} keys. Their module has its own commands, which the console completes and explains.`}
				</p>
				<pre className="mt-4 overflow-x-auto rounded-md bg-[var(--code-background)] px-3 py-2 font-mono text-xs">
					{command}
				</pre>
				<Button size="sm" className="mt-4" asChild>
					<Link href={`/databases/${databaseId}/console?cmd=${encodeURIComponent(command)}`}>
						<SquareTerminal data-icon="inline-start" />
						Open in console
					</Link>
				</Button>
			</div>
		</div>
	);
}

export function MissingValue() {
	return (
		<div className="flex flex-1 items-center justify-center p-10 text-center">
			<div>
				<p className="font-medium text-sm">This key does not exist</p>
				<p className="mt-1 text-muted-foreground text-xs">It may have expired or been deleted.</p>
			</div>
		</div>
	);
}

export type { KeyDetails };

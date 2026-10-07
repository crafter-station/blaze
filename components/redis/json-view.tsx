"use client";

import { Braces, ChevronRight, ClipboardCopy, ListTree, Pencil } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { SegmentedTabs } from "@/components/console-shell/tab-strip";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { copyText, JsonText } from "./value-view";

/**
 * A ReJSON document as a collapsible tree (or pretty text). Every node knows its JSONPath
 * (`$.features.checkout`, `$.regions[0]`, `$["odd key"]`), which is what JSON.SET and
 * JSON.DEL take, so editing or removing one value touches only that path.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function childPath(parent: string, key: string | number): string {
	if (typeof key === "number") return `${parent}[${key}]`;
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
		? `${parent}.${key}`
		: `${parent}[${JSON.stringify(key)}]`;
}

const CHILD_LIMIT = 200;

export function JsonValue({
	json,
	bytes,
	onEditPath,
	toolbar,
}: {
	json: string;
	bytes: number;
	/** Open the editor for one path; the root is `$`. */
	onEditPath?: (path: string, value: unknown) => void;
	toolbar?: ReactNode;
}) {
	const parsed = useMemo(() => {
		try {
			return { ok: true as const, value: JSON.parse(json) as Json };
		} catch {
			return { ok: false as const };
		}
	}, [json]);
	const [mode, setMode] = useState<"tree" | "raw">("tree");
	const pretty = useMemo(
		() => (parsed.ok ? JSON.stringify(parsed.value, null, 2) : json),
		[parsed, json],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-2">
				<SegmentedTabs
					items={[
						{ id: "tree" as const, label: "Tree", icon: ListTree },
						{ id: "raw" as const, label: "JSON", icon: Braces },
					]}
					value={mode}
					onChange={setMode}
					label="Show document as"
					className="w-auto [&>button]:px-2.5"
				/>
				<span className="text-[0.6875rem] text-muted-foreground tabular-nums">
					{formatBytes(bytes)}
				</span>
				<div className="ml-auto flex items-center gap-1">
					{toolbar}
					<Button variant="ghost" size="xs" onClick={() => void copyText(pretty, "document")}>
						<ClipboardCopy data-icon="inline-start" />
						Copy
					</Button>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-auto bg-[var(--code-background)]">
				{!parsed.ok || mode === "raw" ? (
					<pre
						translate="no"
						className="whitespace-pre-wrap break-all px-4 py-3 font-mono text-[0.8125rem] leading-relaxed"
					>
						<JsonText text={pretty} />
					</pre>
				) : (
					<div
						role="tree"
						aria-label="JSON document"
						className="py-2 font-mono text-[0.8125rem]"
						translate="no"
					>
						<Node name="$" path="$" value={parsed.value} depth={0} onEditPath={onEditPath} />
					</div>
				)}
			</div>
		</div>
	);
}

function Node({
	name,
	path,
	value,
	depth,
	onEditPath,
	index,
}: {
	name: string;
	path: string;
	value: Json;
	depth: number;
	onEditPath?: (path: string, value: unknown) => void;
	index?: boolean;
}) {
	const container = value !== null && typeof value === "object";
	const [open, setOpen] = useState(depth < 2);
	const [all, setAll] = useState(false);
	const entries: [string | number, Json][] = container
		? Array.isArray(value)
			? value.map((v, i) => [i, v])
			: Object.entries(value)
		: [];
	const shown = all ? entries : entries.slice(0, CHILD_LIMIT);

	return (
		<div role="treeitem" aria-expanded={container ? open : undefined} aria-selected={false}>
			<div
				className="group/json flex min-h-7 items-center gap-1.5 pr-2 hover:bg-accent/40"
				style={{ paddingLeft: 12 + depth * 16 }}
			>
				{container ? (
					<button
						type="button"
						onClick={() => setOpen((o) => !o)}
						aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
						className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
					>
						<ChevronRight
							className={cn(
								"size-3.5 transition-transform motion-reduce:transition-none",
								open && "rotate-90",
							)}
						/>
					</button>
				) : (
					<span className="size-4 shrink-0" />
				)}
				<span className={cn("shrink-0", index ? "text-muted-foreground" : "text-foreground")}>
					{depth === 0 ? "$" : index ? name : JSON.stringify(name)}
				</span>
				<span className="shrink-0 text-muted-foreground">:</span>
				{container ? (
					<span className="text-muted-foreground text-xs">
						{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
					</span>
				) : (
					<Primitive value={value} />
				)}
				<span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/json:opacity-100 pointer-coarse:opacity-100">
					<button
						type="button"
						onClick={() => void copyText(path, "path")}
						title={`Copy path ${path}`}
						aria-label={`Copy path ${path}`}
						className="rounded-sm px-1 font-sans text-[0.6875rem] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
					>
						{path.length > 40 ? `…${path.slice(-38)}` : path}
					</button>
					{onEditPath && (
						<button
							type="button"
							onClick={() => onEditPath(path, value)}
							aria-label={`Edit ${path}`}
							title={`Edit ${path}`}
							className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
						>
							<Pencil className="size-3.5" />
						</button>
					)}
				</span>
			</div>
			{container && open && (
				<div role="group">
					{shown.map(([key, child]) => (
						<Node
							key={String(key)}
							name={String(key)}
							index={typeof key === "number"}
							path={childPath(path, key)}
							value={child}
							depth={depth + 1}
							onEditPath={onEditPath}
						/>
					))}
					{entries.length > shown.length && (
						<button
							type="button"
							onClick={() => setAll(true)}
							className="my-1 rounded-sm font-sans text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
							style={{ marginLeft: 12 + (depth + 1) * 16 + 22 }}
						>
							Show {entries.length - shown.length} more
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function Primitive({ value }: { value: Json }) {
	if (value === null) return <span className="text-muted-foreground italic">null</span>;
	if (typeof value === "string") {
		return <span className="min-w-0 truncate text-brand-text">{JSON.stringify(value)}</span>;
	}
	return <span className="text-[var(--type-string)] tabular-nums">{String(value)}</span>;
}

"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Clock, Folder, FolderOpen } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { formatTtl } from "@/lib/redis/keys";
import {
	buildTree,
	type KeyEntry,
	type TreeNode,
	type VisibleRow,
	visibleRows,
} from "@/lib/redis/tree";
import { cn } from "@/lib/utils";
import { TypeBadge } from "./type-badge";

/**
 * The loaded keys as a namespace tree (or a flat list), virtualised so tens of thousands
 * of rows stay smooth. A WAI-ARIA tree: arrows move, Right/Left expand and collapse,
 * Enter opens a key. Memory per key is fetched lazily for the rows on screen.
 */

const ROW = 30;

export type TreeView = "tree" | "flat";

export function KeyTree({
	entries,
	view,
	selected,
	onSelect,
	memory,
	onVisibleKeys,
	expanded,
	onExpandedChange,
	footer,
}: {
	entries: KeyEntry[];
	view: TreeView;
	selected: string | null;
	onSelect: (key: string) => void;
	memory: Record<string, number | null>;
	onVisibleKeys: (keys: string[]) => void;
	expanded: Set<string>;
	onExpandedChange: (next: Set<string>) => void;
	footer?: React.ReactNode;
}) {
	const tree = useMemo(() => (view === "tree" ? buildTree(entries) : null), [entries, view]);
	const rows: VisibleRow[] = useMemo(() => {
		if (tree) return visibleRows(tree, expanded);
		return [...entries]
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
			.map((entry) => ({ node: { kind: "key", label: entry.name, entry } as TreeNode, depth: 0 }));
	}, [tree, entries, expanded]);

	const scrollRef = useRef<HTMLDivElement>(null);
	const id = useId();
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => ROW,
		overscan: 12,
	});
	const items = virtualizer.getVirtualItems();

	const [focus, setFocus] = useState(0);
	useEffect(() => {
		if (focus > rows.length - 1) setFocus(Math.max(0, rows.length - 1));
	}, [rows.length, focus]);

	// Ask for memory of the keys actually on screen, once scrolling settles.
	const visibleKeys = items
		.map((item) => rows[item.index]?.node)
		.filter((node): node is Extract<TreeNode, { kind: "key" }> => node?.kind === "key")
		.map((node) => node.entry.key);
	const visibleSignature = visibleKeys.join("\u0000");
	// biome-ignore lint/correctness/useExhaustiveDependencies: the signature is the trigger.
	useEffect(() => {
		const timer = setTimeout(() => onVisibleKeys(visibleKeys), 250);
		return () => clearTimeout(timer);
	}, [visibleSignature]);

	const toggle = (prefix: string, open?: boolean) => {
		const next = new Set(expanded);
		if (open ?? !next.has(prefix)) next.add(prefix);
		else next.delete(prefix);
		onExpandedChange(next);
	};

	function activate(index: number) {
		const row = rows[index];
		if (!row) return;
		if (row.node.kind === "folder") toggle(row.node.prefix);
		else onSelect(row.node.entry.key);
	}

	function onKeyDown(event: React.KeyboardEvent) {
		const row = rows[focus];
		let next = focus;
		switch (event.key) {
			case "ArrowDown":
				next = Math.min(rows.length - 1, focus + 1);
				break;
			case "ArrowUp":
				next = Math.max(0, focus - 1);
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = rows.length - 1;
				break;
			case "PageDown":
				next = Math.min(rows.length - 1, focus + 15);
				break;
			case "PageUp":
				next = Math.max(0, focus - 15);
				break;
			case "ArrowRight":
				if (row?.node.kind === "folder") {
					if (!row.expanded) toggle(row.node.prefix, true);
					else next = Math.min(rows.length - 1, focus + 1);
				}
				break;
			case "ArrowLeft":
				if (row?.node.kind === "folder" && row.expanded) toggle(row.node.prefix, false);
				else if (row && row.depth > 0) {
					for (let i = focus - 1; i >= 0; i--) {
						if (rows[i].depth < row.depth) {
							next = i;
							break;
						}
					}
				}
				break;
			case "Enter":
			case " ":
				activate(focus);
				break;
			default:
				return;
		}
		event.preventDefault();
		setFocus(next);
		virtualizer.scrollToIndex(next, { align: "auto" });
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div
				ref={scrollRef}
				role="tree"
				aria-label="Keys"
				tabIndex={0}
				aria-activedescendant={rows.length ? `${id}-${focus}` : undefined}
				onKeyDown={onKeyDown}
				className="group/tree relative min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 outline-none"
			>
				<div className="relative" style={{ height: virtualizer.getTotalSize() }}>
					{items.map((item) => {
						const row = rows[item.index];
						const node = row.node;
						const focused = item.index === focus;
						const common = {
							id: `${id}-${item.index}`,
							"aria-level": row.depth + 1,
							style: { transform: `translateY(${item.start}px)`, height: ROW },
						};
						const indent = 8 + row.depth * 14;
						if (node.kind === "folder") {
							const Icon = row.expanded ? FolderOpen : Folder;
							return (
								// biome-ignore lint/a11y/useKeyWithClickEvents: the tree handles keys for its rows (aria-activedescendant).
								<div
									role="treeitem"
									key={`f:${node.prefix}`}
									{...common}
									aria-expanded={!!row.expanded}
									aria-selected={false}
									onClick={() => {
										setFocus(item.index);
										toggle(node.prefix);
									}}
									className={cn(
										"absolute inset-x-1 top-0 flex cursor-default select-none items-center gap-1.5 rounded-md pr-2.5 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
										focused &&
											"group-focus-visible/tree:ring-1 group-focus-visible/tree:ring-ring/60 group-focus-visible/tree:ring-inset",
									)}
								>
									<span style={{ width: indent - 4 }} className="shrink-0" />
									<ChevronRight
										className={cn(
											"size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
											row.expanded && "rotate-90",
										)}
									/>
									<Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
									<span className="min-w-0 truncate font-mono text-[0.75rem] text-foreground/90">
										{node.label === "" ? (
											<em className="text-muted-foreground">(empty)</em>
										) : (
											node.label
										)}
									</span>
									<span className="ml-auto pl-2 font-mono text-[0.6875rem] tabular-nums">
										{node.count.toLocaleString()}
									</span>
								</div>
							);
						}
						const entry = node.entry;
						const isSelected = selected === entry.key;
						const bytes = memory[entry.key];
						return (
							// biome-ignore lint/a11y/useKeyWithClickEvents: the tree handles keys for its rows (aria-activedescendant).
							<div
								role="treeitem"
								key={`k:${entry.key}`}
								{...common}
								aria-selected={isSelected}
								onClick={() => {
									setFocus(item.index);
									onSelect(entry.key);
								}}
								title={entry.name}
								className={cn(
									"absolute inset-x-1 top-0 flex cursor-default select-none items-center gap-2 rounded-md pr-2.5 text-[0.8125rem] transition-colors",
									isSelected ? "bg-accent text-foreground" : "hover:bg-accent/60",
									focused &&
										"group-focus-visible/tree:ring-1 group-focus-visible/tree:ring-ring/60 group-focus-visible/tree:ring-inset",
								)}
							>
								<span style={{ width: view === "tree" ? indent + 16 : 4 }} className="shrink-0" />
								<TypeBadge type={entry.type} />
								<span className="min-w-0 flex-1 truncate font-mono text-[0.75rem]">
									{node.label === "" ? (
										<em className="text-muted-foreground">(empty)</em>
									) : (
										node.label
									)}
								</span>
								{entry.ttl >= 0 && (
									<span
										className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted-foreground tabular-nums"
										title={`Expires in ${formatTtl(entry.ttl)}`}
									>
										<Clock className="size-3" />
										{formatTtl(entry.ttl)}
									</span>
								)}
								<span className="w-12 shrink-0 text-right font-mono text-[0.6875rem] text-muted-foreground/80 tabular-nums">
									{bytes === undefined ? "" : bytes === null ? "-" : formatBytes(bytes)}
								</span>
								{isSelected && (
									<span
										aria-hidden="true"
										className="absolute top-1.5 bottom-1.5 -left-1 w-[3px] rounded-r-full bg-brand"
									/>
								)}
							</div>
						);
					})}
				</div>
			</div>
			{footer}
		</div>
	);
}

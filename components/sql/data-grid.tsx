"use client";

import {
	type ColumnDef,
	type ColumnPinningState,
	type ColumnSizingState,
	columnPinningFeature,
	columnResizingFeature,
	columnSizingFeature,
	createSortedRowModel,
	rowSortingFeature,
	type SortingState,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronDown, ClipboardCopy, Eye, Pin, PinOff } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type CellKind,
	columnKind,
	compareCells,
	initialWidth,
	previewCell,
} from "@/lib/sql/cells";
import { toJson, toTsv } from "@/lib/sql/export";
import type { ResultColumn } from "@/lib/sql/types";
import { cn } from "@/lib/utils";

/**
 * The result grid: virtualised rows, resizable and pinnable columns, client-side sort,
 * spreadsheet-style cell selection (click, shift-click, drag, arrows), and copy as TSV or
 * JSON. Rows are arrays, not objects, so two columns with the same name both survive.
 */

type Row = unknown[];
interface Pos {
	r: number;
	c: number;
}

const ROW_HEIGHT = 30;
const ROWNUM_WIDTH = 52;

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	columnSizingFeature,
	columnResizingFeature,
	columnPinningFeature,
});

function clamp(value: number, max: number): number {
	return Math.max(0, Math.min(max, value));
}

/** With the modifier held, a step becomes a jump to the edge. */
function jump(step: number, mod: boolean): number {
	if (step === 0 || !mod || Math.abs(step) === Infinity) return step;
	return step * Infinity;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform);

async function copy(text: string, what: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast.success(`Copied ${what}`);
	} catch {
		toast.error("Clipboard is not available");
	}
}

export function DataGrid({
	columns,
	rows,
	onInspect,
	inspectedRow,
	label,
}: {
	columns: ResultColumn[];
	rows: Row[];
	/** Called with the row's index in `rows` (not its sorted position). */
	onInspect: (rowIndex: number) => void;
	inspectedRow: number | null;
	label: string;
}) {
	const kinds = useMemo<CellKind[]>(
		() =>
			columns.map((column, i) =>
				columnKind(
					column,
					rows.slice(0, 100).map((r) => r[i]),
				),
			),
		[columns, rows],
	);

	const columnDefs = useMemo<ColumnDef<typeof features, Row>[]>(
		() =>
			columns.map((column, i) => ({
				id: String(i),
				accessorFn: (row: Row) => row[i] as never,
				header: column.name,
				size: initialWidth(
					column,
					rows.slice(0, 60).map((r) => r[i]),
				),
				minSize: 56,
				maxSize: 1200,
				sortFn: (a, b) => compareCells(a.original[i], b.original[i], kinds[i]),
			})),
		[columns, rows, kinds],
	);

	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
	const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ start: [], end: [] });

	const table = useTable({
		features,
		columns: columnDefs,
		data: rows,
		state: { sorting, columnSizing, columnPinning },
		onSortingChange: setSorting,
		onColumnSizingChange: setColumnSizing,
		onColumnPinningChange: setColumnPinning,
		columnResizeMode: "onChange",
		enableSortingRemoval: true,
	});

	const sortedRows = table.getRowModel().rows;
	const ordered = [...table.getStartVisibleLeafColumns(), ...table.getCenterVisibleLeafColumns()];
	const pinnedCount = table.getStartVisibleLeafColumns().length;
	const totalWidth = ROWNUM_WIDTH + table.getTotalSize();

	const scrollRef = useRef<HTMLDivElement>(null);
	const gridId = useId();
	const virtualizer = useVirtualizer({
		count: sortedRows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => ROW_HEIGHT,
		overscan: 16,
	});

	/* ---------------- selection ---------------- */

	const [anchor, setAnchor] = useState<Pos | null>(null);
	const [focus, setFocus] = useState<Pos | null>(null);
	const dragging = useRef(false);

	const rect = useMemo(() => {
		if (!anchor || !focus) return null;
		return {
			top: Math.min(anchor.r, focus.r),
			bottom: Math.max(anchor.r, focus.r),
			left: Math.min(anchor.c, focus.c),
			right: Math.max(anchor.c, focus.c),
		};
	}, [anchor, focus]);

	const inRect = (r: number, c: number) =>
		!!rect && r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right;

	// Plain functions rather than callbacks: they read table state that changes on every
	// render, and nothing downstream is memoised on them.
	function selectionData() {
		if (!rect) return null;
		const cols = ordered.slice(rect.left, rect.right + 1).map((col) => Number(col.id));
		const data = sortedRows
			.slice(rect.top, rect.bottom + 1)
			.map((row) => cols.map((i) => row.original[i]));
		return { cols: cols.map((i) => columns[i]), data };
	}

	function copySelection(format: "tsv" | "json", withHeader = false) {
		const selection = selectionData();
		if (!selection) return;
		const cells = selection.data.length * selection.cols.length;
		if (format === "json") {
			void copy(
				toJson(selection.cols, selection.data),
				cells === 1 ? "cell as JSON" : "selection as JSON",
			);
		} else {
			void copy(
				toTsv(withHeader ? selection.cols : null, selection.data),
				cells === 1 ? "cell" : `${cells} cells`,
			);
		}
	}

	function scrollIntoView(pos: Pos) {
		virtualizer.scrollToIndex(pos.r, { align: "auto" });
		requestAnimationFrame(() => {
			const container = scrollRef.current;
			const column = ordered[pos.c];
			if (!container || !column || column.getIsPinned()) return;
			const left = ROWNUM_WIDTH + column.getStart("center") + table.getStartTotalSize();
			const stickyWidth = ROWNUM_WIDTH + table.getStartTotalSize();
			if (left - stickyWidth < container.scrollLeft) container.scrollLeft = left - stickyWidth;
			else if (left + column.getSize() > container.scrollLeft + container.clientWidth) {
				container.scrollLeft = left + column.getSize() - container.clientWidth;
			}
		});
	}

	function onKeyDown(event: React.KeyboardEvent) {
		const mod = isMac() ? event.metaKey : event.ctrlKey;
		if (mod && event.key.toLowerCase() === "c") {
			event.preventDefault();
			copySelection("tsv");
			return;
		}
		if (mod && event.key.toLowerCase() === "a") {
			event.preventDefault();
			if (sortedRows.length && ordered.length) {
				setAnchor({ r: 0, c: 0 });
				setFocus({ r: sortedRows.length - 1, c: ordered.length - 1 });
			}
			return;
		}
		if (event.key === "Enter" && focus) {
			event.preventDefault();
			onInspect(sortedRows[focus.r]?.index ?? 0);
			return;
		}
		if (event.key === "Escape") {
			setAnchor(null);
			setFocus(null);
			return;
		}
		const moves: Record<string, [number, number]> = {
			ArrowUp: [-1, 0],
			ArrowDown: [1, 0],
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1],
			PageUp: [-20, 0],
			PageDown: [20, 0],
			Home: [0, -Infinity],
			End: [0, Infinity],
		};
		const move = moves[event.key];
		if (!move || sortedRows.length === 0) return;
		event.preventDefault();
		const from = focus ?? { r: 0, c: 0 };
		const next = {
			// Ctrl/Cmd+arrow jumps to the edge, like a spreadsheet.
			r: clamp(from.r + jump(move[0], mod), sortedRows.length - 1),
			c: clamp(from.c + jump(move[1], mod), ordered.length - 1),
		};
		setFocus(next);
		if (!event.shiftKey) setAnchor(next);
		scrollIntoView(next);
	}

	function onCellMouseDown(event: React.MouseEvent, pos: Pos) {
		if (event.button === 2 && inRect(pos.r, pos.c)) return; // keep selection for context menu
		if (event.shiftKey && anchor) setFocus(pos);
		else {
			setAnchor(pos);
			setFocus(pos);
		}
		if (event.button === 0) dragging.current = true;
	}

	useEffect(() => {
		const stop = () => {
			dragging.current = false;
		};
		window.addEventListener("mouseup", stop);
		return () => window.removeEventListener("mouseup", stop);
	}, []);

	function selectRow(r: number, extend: boolean) {
		const last = ordered.length - 1;
		if (extend && anchor) {
			setAnchor({ r: anchor.r, c: 0 });
			setFocus({ r, c: last });
		} else {
			setAnchor({ r, c: 0 });
			setFocus({ r, c: last });
		}
		scrollRef.current?.focus({ preventScroll: true });
	}

	const focusedRowIndex = focus ? sortedRows[focus.r]?.index : undefined;
	const mod = isMac() ? "⌘" : "Ctrl+";

	/* ---------------- render ---------------- */

	const stickyLeft = (columnIndex: number) => {
		const column = ordered[columnIndex];
		return column.getIsPinned() ? ROWNUM_WIDTH + column.getStart("start") : undefined;
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					ref={scrollRef}
					role="grid"
					aria-label={label}
					aria-rowcount={sortedRows.length + 1}
					aria-colcount={ordered.length}
					aria-multiselectable="true"
					aria-activedescendant={focus ? `${gridId}-${focus.r}-${focus.c}` : undefined}
					tabIndex={0}
					onKeyDown={onKeyDown}
					className="relative min-h-0 flex-1 overflow-auto overscroll-contain font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
				>
					{/* Header */}
					<div
						role="row"
						className="sticky top-0 z-20 flex h-[34px] border-border border-b bg-card"
						style={{ width: totalWidth }}
					>
						<div
							role="columnheader"
							className="sticky left-0 z-30 flex shrink-0 items-center justify-end border-border border-r bg-card pr-2.5 text-[0.6875rem] text-muted-foreground/70"
							style={{ width: ROWNUM_WIDTH }}
						>
							#
						</div>
						{ordered.map((column, c) => {
							const header = table.getFlatHeaders().find((h) => h.column.id === column.id);
							const meta = columns[Number(column.id)];
							const sorted = column.getIsSorted();
							const pinned = !!column.getIsPinned();
							return (
								<div
									key={column.id}
									role="columnheader"
									aria-sort={
										sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
									}
									className={cn(
										"group/header relative flex shrink-0 items-center border-border border-r bg-card font-sans",
										pinned && "sticky z-30",
										pinned && c === pinnedCount - 1 && "shadow-[1px_0_0_var(--border-strong)]",
									)}
									style={{ width: column.getSize(), left: stickyLeft(c) }}
								>
									<button
										type="button"
										onClick={column.getToggleSortingHandler()}
										title={`Sort by ${meta.name}`}
										className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 pl-2.5 text-left outline-none focus-visible:bg-accent"
									>
										{pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
										<span className="truncate font-medium text-[0.75rem] text-foreground">
											{meta.name}
										</span>
										{meta.type && (
											<span className="truncate font-mono text-[0.625rem] text-muted-foreground/80">
												{meta.type.toLowerCase()}
											</span>
										)}
										{sorted === "asc" && (
											<ArrowUp className="size-3 shrink-0 text-brand-text" aria-hidden />
										)}
										{sorted === "desc" && (
											<ArrowDown className="size-3 shrink-0 text-brand-text" aria-hidden />
										)}
									</button>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<button
												type="button"
												aria-label={`Column options for ${meta.name}`}
												className="mr-1.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
											>
												<ChevronDown className="size-3" />
											</button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="min-w-44 font-sans">
											<DropdownMenuItem onSelect={() => column.toggleSorting(false)}>
												<ArrowUp className="text-muted-foreground" />
												Sort ascending
											</DropdownMenuItem>
											<DropdownMenuItem onSelect={() => column.toggleSorting(true)}>
												<ArrowDown className="text-muted-foreground" />
												Sort descending
											</DropdownMenuItem>
											{sorted && (
												<DropdownMenuItem onSelect={() => column.clearSorting()}>
													Clear sort
												</DropdownMenuItem>
											)}
											<DropdownMenuSeparator />
											<DropdownMenuItem onSelect={() => column.pin(pinned ? false : "start")}>
												{pinned ? (
													<PinOff className="text-muted-foreground" />
												) : (
													<Pin className="text-muted-foreground" />
												)}
												{pinned ? "Unpin column" : "Pin column"}
											</DropdownMenuItem>
											<DropdownMenuItem onSelect={() => void copy(meta.name, "column name")}>
												<ClipboardCopy className="text-muted-foreground" />
												Copy name
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
									{header && (
										<div
											aria-hidden="true"
											onMouseDown={header.getResizeHandler()}
											onTouchStart={header.getResizeHandler()}
											onDoubleClick={() => column.resetSize()}
											className={cn(
												"absolute top-0 -right-[3px] z-10 h-full w-[6px] cursor-col-resize touch-none select-none",
												"after:absolute after:inset-y-1.5 after:left-[2px] after:w-[2px] after:rounded-full after:transition-colors hover:after:bg-brand/60",
												column.getIsResizing() && "after:bg-brand",
											)}
										/>
									)}
								</div>
							);
						})}
					</div>

					{/* Body */}
					<div
						className="relative"
						style={{ height: virtualizer.getTotalSize(), width: totalWidth }}
					>
						{virtualizer.getVirtualItems().map((item) => {
							const row = sortedRows[item.index];
							const r = item.index;
							const inspected = inspectedRow === row.index;
							return (
								<div
									key={row.id}
									role="row"
									aria-rowindex={r + 2}
									className={cn(
										"group/row absolute top-0 left-0 flex border-border/70 border-b",
										inspected ? "bg-brand-soft" : "hover:bg-muted/40",
									)}
									style={{
										height: ROW_HEIGHT,
										width: totalWidth,
										transform: `translateY(${item.start}px)`,
									}}
								>
									<button
										type="button"
										tabIndex={-1}
										onMouseDown={(e) => {
											e.preventDefault();
											selectRow(r, e.shiftKey);
										}}
										onDoubleClick={() => onInspect(row.index)}
										aria-label={`Select row ${r + 1}`}
										className={cn(
											"sticky left-0 z-10 flex shrink-0 items-center justify-end border-border border-r bg-card pr-2.5 text-[0.6875rem] tabular-nums text-muted-foreground/70 hover:text-foreground",
											inspected && "text-brand-text",
										)}
										style={{ width: ROWNUM_WIDTH }}
									>
										{r + 1}
									</button>
									{ordered.map((column, c) => {
										const i = Number(column.id);
										const value = row.original[i];
										const kind = kinds[i];
										const selected = inRect(r, c);
										const focused = focus?.r === r && focus?.c === c;
										const pinned = !!column.getIsPinned();
										return (
											<div
												key={column.id}
												role="gridcell"
												id={`${gridId}-${r}-${c}`}
												aria-selected={selected}
												data-cell={`${r}:${c}`}
												onMouseDown={(e) => onCellMouseDown(e, { r, c })}
												onMouseEnter={() => {
													if (dragging.current) setFocus({ r, c });
												}}
												onDoubleClick={() => onInspect(row.index)}
												title={value === null ? "NULL" : undefined}
												className={cn(
													"flex shrink-0 cursor-default items-center overflow-hidden border-border/70 border-r px-2.5 select-none",
													kind === "number" && "justify-end tabular-nums",
													pinned &&
														"sticky z-[5] bg-card group-hover/row:bg-[color-mix(in_oklab,var(--card),var(--muted)_40%)]",
													pinned &&
														c === pinnedCount - 1 &&
														"shadow-[1px_0_0_var(--border-strong)]",
													selected && "!bg-[color-mix(in_oklab,var(--brand)_13%,var(--card))]",
													focused && "outline outline-1 outline-brand -outline-offset-1",
												)}
												style={{ width: column.getSize(), left: stickyLeft(c) }}
											>
												<CellValue value={value} kind={kind} />
											</div>
										);
									})}
								</div>
							);
						})}
					</div>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent className="min-w-52">
				<ContextMenuItem disabled={!rect} onSelect={() => copySelection("tsv")}>
					<ClipboardCopy />
					{rect && (rect.bottom > rect.top || rect.right > rect.left)
						? "Copy selection"
						: "Copy cell"}
					<ContextMenuShortcut>{mod}C</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuItem disabled={!rect} onSelect={() => copySelection("tsv", true)}>
					Copy with headers
				</ContextMenuItem>
				<ContextMenuItem disabled={!rect} onSelect={() => copySelection("json")}>
					Copy as JSON
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					disabled={focusedRowIndex === undefined}
					onSelect={() => {
						if (focusedRowIndex === undefined) return;
						void copy(toTsv(null, [rows[focusedRowIndex]]), "row");
					}}
				>
					Copy row
				</ContextMenuItem>
				<ContextMenuItem
					disabled={focusedRowIndex === undefined}
					onSelect={() => {
						if (focusedRowIndex === undefined) return;
						const json = toJson(columns, [rows[focusedRowIndex]]);
						void copy(JSON.stringify(JSON.parse(json)[0], null, 2), "row as JSON");
					}}
				>
					Copy row as JSON
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					disabled={focusedRowIndex === undefined}
					onSelect={() => focusedRowIndex !== undefined && onInspect(focusedRowIndex)}
				>
					<Eye />
					Inspect row
					<ContextMenuShortcut>Enter</ContextMenuShortcut>
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function CellValue({ value, kind }: { value: unknown; kind: CellKind }) {
	if (value === null || value === undefined) {
		return <span className="text-muted-foreground/55 italic">NULL</span>;
	}
	if (typeof value === "boolean") {
		return (
			<span className={value ? "text-foreground" : "text-muted-foreground"}>{String(value)}</span>
		);
	}
	if (kind === "json" || typeof value === "object") {
		return <span className="truncate text-foreground/80">{previewCell(value, 300)}</span>;
	}
	if (kind === "binary")
		return <span className="truncate text-muted-foreground">{previewCell(value, 120)}</span>;
	return <span className="truncate">{previewCell(value, 300)}</span>;
}

"use client";

import {
	CheckCircle2,
	CircleAlert,
	CircleDashed,
	Crosshair,
	Download,
	FileJson,
	FileSpreadsheet,
	Rows3,
	Sparkles,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { DataGrid } from "@/components/console-shell/data-grid";
import {
	formatMs,
	isMacPlatform,
	useElapsed,
	useMediaQuery,
} from "@/components/console-shell/hooks";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { toCsv, toJson } from "@/lib/sql/export";
import type { StatementOutcome } from "@/lib/sql/types";
import { cn } from "@/lib/utils";
import { RowInspector } from "./row-inspector";

export interface RunEntry {
	/** Statement text and its offsets in the document at the time it ran. */
	text: string;
	from: number;
	to: number;
	outcome: StatementOutcome;
}

export interface RunRecord {
	id: string;
	startedAt: number;
	finishedAt?: number;
	entries: RunEntry[];
	/** A failure before any statement ran (auth, connection, too many statements). */
	error?: string;
}

export interface ExtraResultTab {
	id: string;
	label: ReactNode;
	content: ReactNode;
	/** Status line shown while this tab is active. */
	footer?: ReactNode;
}

function commandSummary(outcome: StatementOutcome): string {
	const command = outcome.command && outcome.command !== "OK" ? outcome.command : null;
	if (outcome.columns.length > 0)
		return `${outcome.rowCount} row${outcome.rowCount === 1 ? "" : "s"}`;
	if (command && /^(INSERT|UPDATE|DELETE|MERGE|COPY|MOVE|FETCH)$/.test(command)) {
		return `${command} ${outcome.rowCount}`;
	}
	if (command) return command;
	return outcome.rowCount > 0
		? `${outcome.rowCount} row${outcome.rowCount === 1 ? "" : "s"} affected`
		: "OK";
}

function download(name: string, type: string, content: string) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResultsPanel({
	run,
	pending,
	pendingSince,
	onShowError,
	onFixError,
	aiEnabled,
	extraTab,
	activeTab,
	onActiveTabChange,
	exportName,
}: {
	run: RunRecord | null;
	pending: boolean;
	pendingSince: number | null;
	onShowError: (entry: RunEntry) => boolean;
	onFixError?: (entry: RunEntry) => void;
	aiEnabled: boolean;
	extraTab?: ExtraResultTab | null;
	/** Index of the statement tab, or the extra tab's id. */
	activeTab: number | string;
	onActiveTabChange: (tab: number | string) => void;
	exportName: string;
}) {
	const elapsed = useElapsed(pending, pendingSince);
	const desktop = useMediaQuery("(min-width: 1024px)");
	// The inspected row belongs to one result set; switching runs or tabs forgets it.
	const [inspection, setInspection] = useState<{ key: string; row: number } | null>(null);
	const inspectionKey = `${run?.id ?? ""}:${activeTab}`;
	const inspected = inspection?.key === inspectionKey ? inspection.row : null;
	const setInspected = (update: number | null | ((row: number | null) => number | null)) => {
		const row = typeof update === "function" ? update(inspected) : update;
		setInspection(row === null ? null : { key: inspectionKey, row });
	};

	const entries = run?.entries ?? [];
	const showingExtra = typeof activeTab === "string" && extraTab && activeTab === extraTab.id;
	const index =
		typeof activeTab === "number" ? Math.min(activeTab, Math.max(entries.length - 1, 0)) : -1;
	const entry = !showingExtra && index >= 0 ? entries[index] : undefined;
	const outcome = entry?.outcome;
	const hasGrid = !!outcome?.ok && outcome.columns.length > 0;

	const tabs = (
		<div
			role="tablist"
			aria-label="Results"
			className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
		>
			{entries.map((item, i) => {
				const active = !showingExtra && i === index;
				const Icon = item.outcome.skipped
					? CircleDashed
					: item.outcome.ok
						? CheckCircle2
						: CircleAlert;
				return (
					<button
						key={i}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => onActiveTabChange(i)}
						title={item.text}
						className={cn(
							"relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
							active
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
						)}
					>
						<Icon
							className={cn(
								"size-3.5",
								item.outcome.skipped
									? "text-muted-foreground/60"
									: item.outcome.ok
										? "text-muted-foreground"
										: "text-destructive",
							)}
						/>
						{entries.length > 1 && <span className="tabular-nums">{i + 1}</span>}
						<span className="max-w-[160px] truncate">
							{item.outcome.skipped
								? "Not run"
								: item.outcome.ok
									? commandSummary(item.outcome)
									: "Error"}
						</span>
					</button>
				);
			})}
			{extraTab && (
				<button
					type="button"
					role="tab"
					aria-selected={!!showingExtra}
					onClick={() => onActiveTabChange(extraTab.id)}
					className={cn(
						"flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
						showingExtra
							? "bg-accent text-foreground"
							: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
					)}
				>
					{extraTab.label}
				</button>
			)}
		</div>
	);

	return (
		<section aria-label="Results" className="flex min-h-0 flex-1 flex-col bg-card">
			<div className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-2">
				{entries.length > 0 || extraTab ? (
					tabs
				) : (
					<p className="flex flex-1 items-center gap-2 px-1.5 font-medium text-[0.8125rem]">
						<Rows3 className="size-3.5 text-muted-foreground" />
						Results
					</p>
				)}
				{hasGrid && outcome && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="sm" aria-label="Export results">
								<Download data-icon="inline-start" />
								<span className="hidden sm:inline">Export</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								onSelect={() =>
									download(
										`${exportName}.csv`,
										"text/csv;charset=utf-8",
										toCsv(outcome.columns, outcome.rows),
									)
								}
							>
								<FileSpreadsheet className="text-muted-foreground" />
								Download CSV
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() =>
									download(
										`${exportName}.json`,
										"application/json",
										toJson(outcome.columns, outcome.rows),
									)
								}
							>
								<FileJson className="text-muted-foreground" />
								Download JSON
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>

			{pending && (
				<div className="relative h-0.5 shrink-0 overflow-hidden bg-transparent" aria-hidden="true">
					<div className="absolute inset-y-0 w-1/3 animate-[sql-progress_1.1s_ease-in-out_infinite] bg-foreground/50 motion-reduce:animate-none" />
				</div>
			)}

			<div
				className={cn(
					"relative flex min-h-0 flex-1 transition-opacity",
					pending && run && "opacity-50",
				)}
				aria-busy={pending}
			>
				{showingExtra && extraTab ? (
					<div className="min-h-0 flex-1 overflow-auto">{extraTab.content}</div>
				) : !run ? (
					pending ? (
						<GridSkeleton />
					) : (
						<EmptyResults />
					)
				) : run.error ? (
					<ErrorView message={run.error} />
				) : !entry || !outcome ? (
					<EmptyResults />
				) : outcome.skipped ? (
					<Notice>Not run, because an earlier statement in the batch failed.</Notice>
				) : !outcome.ok ? (
					<ErrorView
						message={outcome.error ?? "Query failed"}
						onShow={() => onShowError(entry)}
						onFix={aiEnabled && onFixError ? () => onFixError(entry) : undefined}
					/>
				) : hasGrid ? (
					<>
						<DataGrid
							key={inspectionKey}
							columns={outcome.columns}
							rows={outcome.rows}
							onInspect={setInspected}
							inspectedRow={inspected}
							label={`Result ${index + 1}`}
						/>
						{inspected !== null && outcome.rows[inspected] && desktop && (
							<RowInspector
								className="w-[min(380px,40%)] shrink-0 border-border border-l"
								columns={outcome.columns}
								row={outcome.rows[inspected]}
								index={inspected}
								total={outcome.rows.length}
								onPrev={() => setInspected((i) => Math.max(0, (i ?? 0) - 1))}
								onNext={() => setInspected((i) => Math.min(outcome.rows.length - 1, (i ?? 0) + 1))}
								onClose={() => setInspected(null)}
							/>
						)}
					</>
				) : (
					<Notice icon={CheckCircle2}>
						<span className="font-mono text-foreground">{commandSummary(outcome)}</span>
						<span className="text-muted-foreground"> · statement completed</span>
					</Notice>
				)}
			</div>

			{!desktop && hasGrid && outcome && (
				<Sheet open={inspected !== null} onOpenChange={(open) => !open && setInspected(null)}>
					<SheetContent side="bottom" className="h-[80dvh] gap-0 p-0" showCloseButton={false}>
						<SheetHeader className="sr-only">
							<SheetTitle>Row details</SheetTitle>
							<SheetDescription>Every column of the selected row</SheetDescription>
						</SheetHeader>
						{inspected !== null && outcome.rows[inspected] && (
							<RowInspector
								className="h-full"
								columns={outcome.columns}
								row={outcome.rows[inspected]}
								index={inspected}
								total={outcome.rows.length}
								onPrev={() => setInspected((i) => Math.max(0, (i ?? 0) - 1))}
								onNext={() => setInspected((i) => Math.min(outcome.rows.length - 1, (i ?? 0) + 1))}
								onClose={() => setInspected(null)}
							/>
						)}
					</SheetContent>
				</Sheet>
			)}

			<footer className="flex h-8 shrink-0 items-center gap-3 border-border border-t px-3 text-[0.6875rem] text-muted-foreground">
				{showingExtra && extraTab?.footer && !pending ? (
					extraTab.footer
				) : pending ? (
					<span className="font-mono tabular-nums">Running… {formatMs(elapsed)}</span>
				) : outcome && !showingExtra ? (
					<>
						{outcome.ok && <span className="tabular-nums">{commandSummary(outcome)}</span>}
						<span className="font-mono tabular-nums">{formatMs(outcome.durationMs)}</span>
						{outcome.truncated && (
							<span className="flex items-center gap-1 text-warning">
								<TriangleAlert className="size-3" />
								Showing the first {outcome.rows.length} rows. Add a LIMIT to see others.
							</span>
						)}
						{entries.length > 1 && run?.finishedAt && (
							<span className="ml-auto font-mono tabular-nums">
								{entries.filter((e) => !e.outcome.skipped).length} of {entries.length} statements ·{" "}
								{formatMs(run.finishedAt - run.startedAt)} total
							</span>
						)}
					</>
				) : (
					<span>Read-only results. Edit rows in the Table browser.</span>
				)}
			</footer>
		</section>
	);
}

function Notice({
	children,
	icon: Icon = CircleDashed,
}: {
	children: ReactNode;
	icon?: typeof CircleDashed;
}) {
	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<p className="flex items-center gap-2 text-sm">
				<Icon className="size-4 shrink-0 text-muted-foreground" />
				<span className="text-muted-foreground">{children}</span>
			</p>
		</div>
	);
}

function ErrorView({
	message,
	onShow,
	onFix,
}: {
	message: string;
	onShow?: () => boolean;
	onFix?: () => void;
}) {
	const [located, setLocated] = useState<boolean | null>(null);
	return (
		<div className="flex-1 overflow-auto p-4">
			<div
				role="alert"
				className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3.5"
			>
				<div className="flex items-start gap-2.5">
					<CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
					<div className="min-w-0 flex-1">
						<p className="font-medium text-destructive text-sm">Query failed</p>
						{/* The engine's own message, verbatim: it describes only the tenant's database. */}
						<p className="mt-1 whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs">
							{message}
						</p>
						{(onShow || onFix) && (
							<div className="mt-3 flex flex-wrap items-center gap-2">
								{onShow && (
									<Button variant="outline" size="xs" onClick={() => setLocated(onShow())}>
										<Crosshair data-icon="inline-start" />
										Show in editor
									</Button>
								)}
								{onFix && (
									<Button variant="outline" size="xs" onClick={onFix}>
										<Sparkles data-icon="inline-start" />
										Fix with AI
									</Button>
								)}
								{located === false && (
									<span className="text-muted-foreground text-xs">
										The engine did not say where.
									</span>
								)}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function EmptyResults() {
	const mod = isMacPlatform() ? "⌘" : "Ctrl";
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
			<p className="text-muted-foreground text-sm">Run a query to see its results here.</p>
			<dl className="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-1.5 text-muted-foreground text-xs">
				<dt className="flex justify-end gap-1">
					<Kbd>{mod}</Kbd>
					<Kbd>Enter</Kbd>
				</dt>
				<dd className="text-left">Run statement at cursor or selection</dd>
				<dt className="flex justify-end gap-1">
					<Kbd>Shift</Kbd>
					<Kbd>{mod}</Kbd>
					<Kbd>Enter</Kbd>
				</dt>
				<dd className="text-left">Run everything</dd>
				<dt className="flex justify-end gap-1">
					<Kbd>{mod}</Kbd>
					<Kbd>K</Kbd>
				</dt>
				<dd className="text-left">Command palette</dd>
			</dl>
		</div>
	);
}

function GridSkeleton() {
	return (
		<div className="flex-1 space-y-2.5 p-4" aria-hidden="true">
			{[72, 56, 64, 48, 60].map((width, i) => (
				<div
					key={i}
					className="h-3 animate-pulse rounded bg-foreground/[0.06] motion-reduce:animate-none"
					style={{ width: `${width}%` }}
				/>
			))}
		</div>
	);
}

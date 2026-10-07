"use client";

import {
	Braces,
	ChevronRight,
	CircleAlert,
	ClipboardCopy,
	Gauge,
	TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatMs } from "@/components/console-shell/hooks";
import { Button } from "@/components/ui/button";
import { formatCount, type PlanNode, type PlanTree } from "@/lib/sql/explain";
import { cn } from "@/lib/utils";

export interface ExplainState {
	status: "loading" | "done" | "error";
	statement: string;
	analyzed: boolean;
	tree?: PlanTree;
	raw?: unknown;
	error?: string;
	durationMs?: number;
}

/**
 * A query plan as a tree: what each step does and to which table, estimated and actual
 * rows, and how much of the plan's work happens in that step alone. The steps doing most
 * of the work are marked, which is the question you open a plan to answer.
 */
export function ExplainView({
	state,
	canAnalyze,
	onAnalyze,
	onShowError,
}: {
	state: ExplainState;
	canAnalyze: boolean;
	onAnalyze: () => void;
	onShowError: () => boolean;
}) {
	const [showRaw, setShowRaw] = useState(false);
	const rawText = useMemo(
		() => (typeof state.raw === "string" ? state.raw : JSON.stringify(state.raw ?? null, null, 2)),
		[state.raw],
	);

	if (state.status === "loading") {
		return (
			<div role="status" className="space-y-2 p-4" aria-busy="true" aria-label="Planning query">
				{[0, 1, 2, 3].map((depth) => (
					<div
						key={depth}
						className="h-11 animate-pulse rounded-lg bg-foreground/[0.05] motion-reduce:animate-none"
						style={{ marginLeft: depth * 20, width: `calc(100% - ${depth * 20}px)` }}
					/>
				))}
			</div>
		);
	}

	if (state.status === "error" || !state.tree) {
		return (
			<div className="p-4">
				<div
					role="alert"
					className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3.5"
				>
					<p className="flex items-center gap-2 font-medium text-destructive text-sm">
						<CircleAlert className="size-4" />
						Could not explain this statement
					</p>
					<p className="mt-1 whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs">
						{state.error}
					</p>
					<Button variant="outline" size="xs" className="mt-3" onClick={() => onShowError()}>
						Show in editor
					</Button>
				</div>
			</div>
		);
	}

	const tree = state.tree;
	const metric = tree.analyzed ? "time" : "cost";
	// SQLite's EXPLAIN QUERY PLAN has no costs: show the plan's shape without empty bars.
	const weighted = hasWeight(tree.root);

	return (
		<div className="flex min-h-full flex-col">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-b px-4 py-2.5 text-xs">
				<span
					className={cn(
						"rounded-sm border px-1.5 py-px font-medium text-[0.6875rem]",
						tree.analyzed
							? "border-brand/40 text-brand-text"
							: "border-border text-muted-foreground",
					)}
				>
					{tree.analyzed ? "Analyzed" : "Estimated"}
				</span>
				{tree.totalCost !== undefined && (
					<Metric
						label="Total cost"
						value={tree.totalCost.toLocaleString("en-US", { maximumFractionDigits: 2 })}
					/>
				)}
				{tree.planningMs !== undefined && (
					<Metric label="Planning" value={formatMs(tree.planningMs)} />
				)}
				{tree.executionMs !== undefined && (
					<Metric label="Execution" value={formatMs(tree.executionMs)} />
				)}
				<Metric label="Steps" value={String(tree.nodeCount)} />
				<div className="ml-auto flex items-center gap-1.5">
					{canAnalyze && !tree.analyzed && (
						<Button
							variant="outline"
							size="xs"
							onClick={onAnalyze}
							title="Runs the statement to measure it"
						>
							<Gauge data-icon="inline-start" />
							Run with ANALYZE
						</Button>
					)}
					<Button
						variant={showRaw ? "secondary" : "ghost"}
						size="xs"
						onClick={() => setShowRaw((v) => !v)}
						aria-pressed={showRaw}
					>
						<Braces data-icon="inline-start" />
						Raw
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Copy raw plan"
						title="Copy raw plan"
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(rawText);
								toast.success("Copied plan");
							} catch {
								toast.error("Clipboard is not available");
							}
						}}
					>
						<ClipboardCopy />
					</Button>
				</div>
			</div>

			{showRaw ? (
				<pre className="flex-1 overflow-auto p-4 font-mono text-[0.75rem] leading-relaxed">
					{rawText}
				</pre>
			) : (
				<div className="flex-1 overflow-auto p-4">
					<ul className="space-y-1.5" translate="no">
						<PlanNodeView
							node={tree.root}
							metric={metric}
							analyzed={tree.analyzed}
							weighted={weighted}
						/>
					</ul>
					<p className="mt-4 text-[0.6875rem] text-muted-foreground">
						{weighted ? (
							<>
								Share is this step's own {metric === "time" ? "time" : "cost"}, excluding the steps
								beneath it.
								{!tree.analyzed &&
									canAnalyze &&
									" Estimates come from table statistics; ANALYZE measures the real thing."}
							</>
						) : (
							"This engine reports the plan's shape without costs. SCAN means every row is read; SEARCH uses an index."
						)}
					</p>
				</div>
			)}
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<span className="text-muted-foreground">
			{label} <span className="font-mono text-foreground tabular-nums">{value}</span>
		</span>
	);
}

function PlanNodeView({
	node,
	metric,
	analyzed,
	weighted,
}: {
	node: PlanNode;
	metric: "time" | "cost";
	analyzed: boolean;
	weighted: boolean;
}) {
	const [open, setOpen] = useState(node.heat === "hot");
	const percent = Math.round(node.share * 100);
	const hasDetails = node.details.length > 0;

	return (
		<li>
			<div
				data-plan-node
				data-heat={node.heat}
				className={cn(
					"relative rounded-lg border bg-card px-3 py-2 shadow-xs",
					node.heat === "hot"
						? "border-warning/50 bg-[color-mix(in_oklab,var(--warning)_6%,var(--card))]"
						: "border-border",
				)}
			>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						disabled={!hasDetails}
						aria-expanded={hasDetails ? open : undefined}
						className="flex min-w-0 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
					>
						<ChevronRight
							className={cn(
								"size-3.5 shrink-0 text-muted-foreground transition-transform",
								open && "rotate-90",
								!hasDetails && "invisible",
							)}
						/>
						<span className="font-medium text-[0.8125rem]">{node.label}</span>
						{node.target && (
							<span className="truncate font-mono text-muted-foreground text-xs">
								{node.target}
							</span>
						)}
					</button>
					<div className="ml-auto flex shrink-0 items-center gap-3 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
						{node.estimatedRows !== undefined && (
							<span title="Estimated rows">
								{analyzed && node.actualRows !== undefined ? (
									<>
										<span className="text-foreground">{formatCount(node.actualRows)}</span>
										<span className="text-muted-foreground/70">
											{" "}
											/ est {formatCount(node.estimatedRows)}
										</span>
									</>
								) : (
									<>est {formatCount(node.estimatedRows)}</>
								)}{" "}
								rows
							</span>
						)}
						{node.loops !== undefined && node.loops > 1 && <span>×{node.loops} loops</span>}
						{metric === "time" && node.selfTimeMs !== undefined && (
							<span>{formatMs(node.selfTimeMs)}</span>
						)}
						{metric === "cost" && node.selfCost !== undefined && (
							<span>
								cost {node.selfCost.toLocaleString("en-US", { maximumFractionDigits: 2 })}
							</span>
						)}
						{weighted && (
							<span
								className="flex w-[72px] items-center gap-1.5"
								title={`${percent}% of the plan's ${metric}`}
							>
								<span className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
									<span
										className={cn(
											"block h-full rounded-full",
											node.heat === "hot" ? "bg-warning" : "bg-foreground/45",
										)}
										style={{ width: `${Math.max(percent, node.share > 0 ? 3 : 0)}%` }}
									/>
								</span>
								<span
									className={cn(
										"w-7 text-right",
										node.heat === "hot" && "font-medium text-warning",
									)}
								>
									{percent}%
								</span>
							</span>
						)}
					</div>
				</div>
				{node.warnings.length > 0 && (
					<ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-5">
						{node.warnings.map((warning) => (
							<li key={warning} className="flex items-center gap-1 text-[0.6875rem] text-warning">
								<TriangleAlert className="size-3" />
								{warning}
							</li>
						))}
					</ul>
				)}
				{open && hasDetails && (
					<dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-border border-t pt-2 pl-5 text-[0.6875rem]">
						{node.details.map(([key, value]) => (
							<div key={key} className="contents">
								<dt className="text-muted-foreground">{key}</dt>
								<dd className="break-words font-mono text-foreground/85">{value}</dd>
							</div>
						))}
					</dl>
				)}
			</div>
			{node.children.length > 0 && (
				<ul className="mt-1.5 ml-3 space-y-1.5 border-border border-l pl-3">
					{node.children.map((child) => (
						<PlanNodeView
							key={child.id}
							node={child}
							metric={metric}
							analyzed={analyzed}
							weighted={weighted}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function hasWeight(node: PlanNode): boolean {
	return node.share > 0 || node.children.some(hasWeight);
}

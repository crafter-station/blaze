"use client";

import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/format";
import { type HealthSnapshot, MODULE_LABEL } from "@/lib/redis/types";
import { cn } from "@/lib/utils";

/**
 * The Browser's health strip: memory against the quota (the number `noeviction` refuses
 * writes at), key count and hit rate, with a refresh. Compact on purpose: it is context
 * for the keys below, not a dashboard of its own (Monitoring is that).
 */

export function HealthBar({
	health,
	loading,
	error,
	onRefresh,
}: {
	health: HealthSnapshot | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
}) {
	const used = health ? health.usedMemory / health.maxMemory : 0;
	const percent = Math.min(100, Math.round(used * 1000) / 10);
	const warn = percent >= 80;
	const full = percent >= 98;
	const lookups = health ? health.hits + health.misses : 0;
	const hitRate = health && lookups > 0 ? (health.hits / lookups) * 100 : null;

	return (
		<section
			aria-label="Database health"
			className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-border border-b bg-card px-3 py-2 text-xs sm:px-4"
		>
			<div className="flex min-w-0 items-center gap-2.5">
				<span className="text-muted-foreground">Memory</span>
				{health ? (
					<>
						<span className="font-mono tabular-nums">
							{formatBytes(health.usedMemory)}
							<span className="text-muted-foreground"> / {formatBytes(health.maxMemory)}</span>
						</span>
						<span
							role="meter"
							aria-label="Memory used"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={percent}
							aria-valuetext={`${percent}% of the memory limit used`}
							className="relative h-1.5 w-24 overflow-hidden rounded-full bg-foreground/[0.08] sm:w-32"
						>
							<span
								className={cn(
									"absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
									full ? "bg-destructive" : warn ? "bg-warning" : "bg-foreground/60",
								)}
								style={{ width: `${Math.max(percent, 1.5)}%` }}
							/>
						</span>
						<span
							className={cn(
								"tabular-nums",
								warn ? "font-medium text-warning" : "text-muted-foreground",
								full && "text-destructive",
							)}
						>
							{percent}%
						</span>
						{warn && (
							<Tooltip>
								<TooltipTrigger asChild>
									<TriangleAlert
										className={cn("size-3.5", full ? "text-destructive" : "text-warning")}
										aria-label="Close to the memory limit"
									/>
								</TooltipTrigger>
								<TooltipContent className="max-w-64">
									Writes fail once the limit is reached: nothing is evicted. Delete keys or set TTLs
									to free memory.
								</TooltipContent>
							</Tooltip>
						)}
					</>
				) : (
					<Placeholder width="w-40" />
				)}
			</div>

			<div className="flex items-center gap-2">
				<span className="text-muted-foreground">Keys</span>
				{health ? (
					<span className="font-mono tabular-nums">{health.keys.toLocaleString()}</span>
				) : (
					<Placeholder width="w-10" />
				)}
			</div>

			<div className="flex items-center gap-2">
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="cursor-default text-muted-foreground underline decoration-border-strong decoration-dotted underline-offset-4">
							Hit rate
						</span>
					</TooltipTrigger>
					<TooltipContent className="max-w-64">
						Share of key lookups that found a key, since the server started (keyspace hits and
						misses from INFO stats).
					</TooltipContent>
				</Tooltip>
				{health ? (
					<span className="font-mono tabular-nums">
						{hitRate === null ? "n/a" : `${hitRate >= 99.95 ? "100" : hitRate.toFixed(1)}%`}
					</span>
				) : (
					<Placeholder width="w-10" />
				)}
			</div>

			{health && (
				<p className="hidden min-w-0 items-center gap-1.5 truncate text-muted-foreground xl:flex">
					{health.server.version && <span>Redis {health.server.version}</span>}
					{health.server.modules.length > 0 && (
						<span className="truncate">
							·{" "}
							{health.server.modules
								.map((m) => MODULE_LABEL[m] ?? m)
								.sort()
								.join(", ")}
						</span>
					)}
				</p>
			)}

			<div className="ml-auto flex items-center gap-2">
				{error && (
					<span role="alert" className="max-w-64 truncate text-destructive" title={error}>
						{error}
					</span>
				)}
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={onRefresh}
					disabled={loading}
					aria-label="Refresh health"
					title="Refresh"
				>
					{loading ? (
						<Loader2 className="animate-spin motion-reduce:animate-none" />
					) : (
						<RefreshCw />
					)}
				</Button>
			</div>
		</section>
	);
}

function Placeholder({ width }: { width: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"h-3 animate-pulse rounded bg-foreground/[0.07] motion-reduce:animate-none",
				width,
			)}
		/>
	);
}

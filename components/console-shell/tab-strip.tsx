"use client";

import { Bookmark, Loader2, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The console's tab row: one tab per query (or command session), middle-click or the ×
 * to close, + to add. The selected tab carries the brand underline, the one place the
 * accent appears in the chrome.
 */

export interface StripTab {
	id: string;
	title: string;
	/** Shows a spinner while this tab's run is in flight. */
	pending?: boolean;
	/** Shows a bookmark: the tab holds a saved query. */
	saved?: boolean;
	/** Shows a dot: the saved query has unsaved changes. */
	dirty?: boolean;
}

export function TabStrip({
	tabs,
	activeId,
	onSelect,
	onClose,
	onNew,
	label,
	newLabel,
	leading,
}: {
	tabs: StripTab[];
	activeId: string;
	onSelect: (id: string) => void;
	onClose: (id: string) => void;
	onNew: () => void;
	/** Accessible name of the tab list, e.g. "Queries". */
	label: string;
	/** Accessible name of the + button, e.g. "New query tab". */
	newLabel: string;
	/** Rendered before the tabs, e.g. the side-panel toggle. */
	leading?: ReactNode;
}) {
	return (
		<div className="flex h-10 shrink-0 items-center gap-1 border-border border-b bg-background pr-2 pl-1.5">
			{leading}
			<div
				role="tablist"
				aria-label={label}
				className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
			>
				{tabs.map((tab) => {
					const selected = tab.id === activeId;
					return (
						<div
							key={tab.id}
							className={cn(
								"group/tab relative flex h-8 shrink-0 items-center rounded-md text-[0.8125rem] transition-colors",
								selected
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
							)}
						>
							<button
								type="button"
								role="tab"
								aria-selected={selected}
								onClick={() => onSelect(tab.id)}
								onAuxClick={(e) => e.button === 1 && onClose(tab.id)}
								className="flex h-full max-w-[180px] items-center gap-1.5 rounded-md pr-1 pl-2.5 focus-visible:outline-2 focus-visible:outline-ring"
							>
								{tab.pending && (
									<Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
								)}
								{tab.saved && <Bookmark className="size-3 shrink-0" aria-hidden="true" />}
								<span className="truncate">{tab.title}</span>
								{tab.dirty && (
									<span
										className="size-1.5 shrink-0 rounded-full bg-foreground/50"
										title="Unsaved changes"
									>
										<span className="sr-only">(unsaved changes)</span>
									</span>
								)}
							</button>
							<button
								type="button"
								onClick={() => onClose(tab.id)}
								aria-label={`Close ${tab.title}`}
								className={cn(
									"mr-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
									!selected &&
										"opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
								)}
							>
								<X className="size-3" />
							</button>
							{selected && (
								<span
									aria-hidden="true"
									className="absolute inset-x-2 -bottom-[5px] h-0.5 rounded-full bg-brand"
								/>
							)}
						</div>
					);
				})}
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onNew}
					aria-label={newLabel}
					title={newLabel}
				>
					<Plus />
				</Button>
			</div>
		</div>
	);
}

/** Small segmented control used as a tab list in side panels: Schema, Saved, History. */
export function SegmentedTabs<T extends string>({
	items,
	value,
	onChange,
	label,
	className,
}: {
	items: { id: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
	value: T;
	onChange: (value: T) => void;
	label: string;
	className?: string;
}) {
	return (
		<div role="tablist" aria-label={label} className={cn("flex items-center gap-0.5", className)}>
			{items.map((item) => (
				<button
					key={item.id}
					type="button"
					role="tab"
					aria-selected={value === item.id}
					onClick={() => onChange(item.id)}
					className={cn(
						"flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
						value === item.id
							? "bg-accent font-medium text-foreground"
							: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
					)}
				>
					{item.icon && <item.icon className="size-3.5" />}
					{item.label}
				</button>
			))}
		</div>
	);
}

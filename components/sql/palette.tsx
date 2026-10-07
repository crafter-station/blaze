"use client";

import type { LucideIcon } from "lucide-react";
import { Bookmark, History, Table2 } from "lucide-react";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import type { SavedQueryView } from "@/lib/saved-queries";
import type { SchemaTable } from "@/lib/sql/types";
import type { HistoryEntry } from "./history";

export interface PaletteAction {
	id: string;
	label: string;
	icon: LucideIcon;
	shortcut?: string;
	keywords?: string[];
	disabled?: boolean;
	run: () => void;
}

/**
 * ⌘K: every console action, every table, saved query and recent run, searchable from the
 * keyboard. Selecting an item closes the palette before acting, so focus lands back in the
 * editor rather than in a dialog that is going away.
 */
export function CommandPalette({
	open,
	onOpenChange,
	actions,
	tables,
	saved,
	history,
	onPreviewTable,
	onOpenSaved,
	onOpenHistory,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	actions: PaletteAction[];
	tables: SchemaTable[];
	saved: SavedQueryView[];
	history: HistoryEntry[];
	onPreviewTable: (table: SchemaTable) => void;
	onOpenSaved: (query: SavedQueryView) => void;
	onOpenHistory: (entry: HistoryEntry) => void;
}) {
	const pick = (fn: () => void) => () => {
		onOpenChange(false);
		// Let the dialog release focus before the action moves it.
		setTimeout(fn, 0);
	};

	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title="SQL console commands"
			description="Run actions, open tables, saved queries and recent runs"
			className="sm:max-w-xl"
		>
			<Command loop>
				<CommandInput placeholder="Type a command, table or saved query…" />
				<CommandList className="max-h-[min(60dvh,420px)]">
					<CommandEmpty>No matches.</CommandEmpty>
					<CommandGroup heading="Actions">
						{actions
							.filter((a) => !a.disabled)
							.map((action) => (
								<CommandItem
									key={action.id}
									value={`${action.label} ${action.keywords?.join(" ") ?? ""}`}
									onSelect={pick(action.run)}
								>
									<action.icon />
									{action.label}
									{action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
								</CommandItem>
							))}
					</CommandGroup>
					{tables.length > 0 && (
						<>
							<CommandSeparator />
							<CommandGroup heading="Preview a table">
								{tables.map((table) => (
									<CommandItem
										key={`${table.schema}.${table.name}`}
										value={`preview table ${table.schema}.${table.name}`}
										onSelect={pick(() => onPreviewTable(table))}
									>
										<Table2 />
										<span className="font-mono text-[0.8125rem]">{table.name}</span>
										<span className="ml-1 text-muted-foreground text-xs">{table.schema}</span>
									</CommandItem>
								))}
							</CommandGroup>
						</>
					)}
					{saved.length > 0 && (
						<>
							<CommandSeparator />
							<CommandGroup heading="Saved queries">
								{saved.map((query) => (
									<CommandItem
										key={query.id}
										value={`saved ${query.name} ${query.id}`}
										onSelect={pick(() => onOpenSaved(query))}
									>
										<Bookmark />
										{query.name}
									</CommandItem>
								))}
							</CommandGroup>
						</>
					)}
					{history.length > 0 && (
						<>
							<CommandSeparator />
							<CommandGroup heading="Recent runs">
								{history.slice(0, 8).map((entry) => (
									<CommandItem
										key={entry.id}
										value={`recent ${entry.sql.slice(0, 200)} ${entry.id}`}
										onSelect={pick(() => onOpenHistory(entry))}
									>
										<History />
										<span className="truncate font-mono text-xs">
											{entry.sql.replace(/\s+/g, " ").slice(0, 90)}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						</>
					)}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}

export interface ShortcutGroup {
	title: string;
	items: { keys: string[]; label: string }[];
}

export function ShortcutsDialog({
	open,
	onOpenChange,
	groups,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	groups: ShortcutGroup[];
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription>Editor shortcuts work while the editor has focus.</DialogDescription>
				</DialogHeader>
				<div className="max-h-[60dvh] space-y-5 overflow-y-auto">
					{groups.map((group) => (
						<section key={group.title}>
							<h3 className="mb-2 font-medium text-muted-foreground text-xs">{group.title}</h3>
							<dl className="divide-y divide-border rounded-lg border border-border">
								{group.items.map((item) => (
									<div
										key={item.label}
										className="flex items-center justify-between gap-4 px-3 py-2"
									>
										<dt className="text-sm">{item.label}</dt>
										<dd className="flex shrink-0 items-center gap-1">
											{item.keys.map((key) => (
												<Kbd key={key}>{key}</Kbd>
											))}
										</dd>
									</div>
								))}
							</dl>
						</section>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}

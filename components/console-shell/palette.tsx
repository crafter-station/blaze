"use client";

import type { LucideIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
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

export interface PaletteAction {
	id: string;
	label: string;
	icon: LucideIcon;
	shortcut?: string;
	keywords?: string[];
	disabled?: boolean;
	run: () => void;
}

/** A searchable group below the actions: tables, saved queries, recent runs, keys. */
export interface PaletteGroup {
	heading: string;
	items: {
		id: string;
		/** What the search matches against. Must be unique within the palette. */
		value: string;
		icon: LucideIcon;
		label: ReactNode;
		onSelect: () => void;
	}[];
}

/**
 * ⌘K: every console action, plus whatever the console lists (tables, saved queries,
 * recent runs), searchable from the keyboard. Selecting an item closes the palette before
 * acting, so focus lands back in the editor rather than in a dialog that is going away.
 */
export function CommandPalette({
	open,
	onOpenChange,
	actions,
	groups = [],
	title,
	description,
	placeholder,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	actions: PaletteAction[];
	groups?: PaletteGroup[];
	title: string;
	description: string;
	placeholder: string;
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
			title={title}
			description={description}
			className="sm:max-w-xl"
		>
			<Command loop>
				<CommandInput placeholder={placeholder} />
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
					{groups
						.filter((group) => group.items.length > 0)
						.map((group) => (
							<Fragment key={group.heading}>
								<CommandSeparator />
								<CommandGroup heading={group.heading}>
									{group.items.map((item) => (
										<CommandItem key={item.id} value={item.value} onSelect={pick(item.onSelect)}>
											<item.icon />
											{item.label}
										</CommandItem>
									))}
								</CommandGroup>
							</Fragment>
						))}
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
	description = "Editor shortcuts work while the editor has focus.",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	groups: ShortcutGroup[];
	description?: string;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
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

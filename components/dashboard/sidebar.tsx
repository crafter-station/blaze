"use client";

import {
	Activity,
	Check,
	ChevronsLeft,
	ChevronsRight,
	ChevronsUpDown,
	Database,
	Eye,
	KeyRound,
	LayoutGrid,
	type LucideIcon,
	MessageSquare,
	Settings,
	SquareTerminal,
	Table2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Sidebar following Neon's information architecture: a workspace-scoped section, then a
 * section scoped to the resource you are currently inside, then utilities at the bottom.
 *
 * The IA is the part worth copying — scoping navigation to the thing you are looking at is
 * what makes a console with this much surface area navigable. Palette and copy are ours
 * (PLAN.md Q10).
 *
 * Neon's second section scopes to a branch and switches with a dropdown. blaze has no
 * branches, so it scopes to a database. Same shape, different noun.
 */

export interface SidebarDatabase {
	id: string;
	name: string;
}

interface NavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	soon?: boolean;
}

const WORKSPACE: NavItem[] = [
	{ href: "/projects", label: "Overview", icon: LayoutGrid },
	{ href: "/databases", label: "Databases", icon: Database },
	{ href: "/api-keys", label: "API keys", icon: KeyRound },
	{ href: "/settings", label: "Settings", icon: Settings },
];

function databaseNav(id: string): NavItem[] {
	return [
		{ href: `/databases/${id}`, label: "Overview", icon: Eye },
		{ href: `/databases/${id}/monitoring`, label: "Monitoring", icon: Activity },
		{ href: `/databases/${id}/sql`, label: "SQL Editor", icon: SquareTerminal, soon: true },
		{ href: `/databases/${id}/tables`, label: "Tables", icon: Table2, soon: true },
	];
}

/** `/databases/db_x7f2/monitoring` -> `db_x7f2`; anything else -> null. */
function currentDatabaseId(pathname: string): string | null {
	const match = pathname.match(/^\/databases\/([^/]+)/);
	return match ? match[1] : null;
}

export function Sidebar({ databases }: { databases: SidebarDatabase[] }) {
	const pathname = usePathname();
	const [collapsed, setCollapsed] = useState(false);

	const activeId = currentDatabaseId(pathname);
	const active = databases.find((d) => d.id === activeId) ?? null;

	return (
		<aside
			className={cn(
				"sticky top-0 flex h-screen shrink-0 flex-col border-border border-r bg-sidebar transition-[width] duration-200",
				collapsed ? "w-[68px]" : "w-[248px]",
			)}
		>
			<nav className="flex-1 overflow-y-auto px-3 py-5">
				<Section label="Workspace" collapsed={collapsed}>
					{WORKSPACE.map((item) => (
						<Item key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
					))}
				</Section>

				<div className="mt-7">
					{!collapsed && (
						<div className="mb-2 flex items-center justify-between gap-2 px-3">
							<p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
								Database
							</p>
							{active && <DatabaseSwitcher databases={databases} active={active} />}
						</div>
					)}

					{active ? (
						<div className="space-y-0.5">
							{databaseNav(active.id).map((item) => (
								<Item key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
							))}
						</div>
					) : (
						!collapsed && (
							// Rendered rather than hidden: a section that vanishes makes the console look
							// like it changed shape. Saying why beats an unexplained gap.
							<p className="px-3 py-2 text-muted-foreground/60 text-xs leading-relaxed">
								Open a database to see its overview, monitoring and editor.
							</p>
						)
					)}
				</div>
			</nav>

			<div className="border-border border-t px-3 py-3">
				<a
					href="https://github.com/crafter-station/blaze"
					target="_blank"
					rel="noreferrer"
					className="flex items-center gap-3 rounded-md px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-foreground"
				>
					<MessageSquare className="size-[18px] shrink-0" />
					{!collapsed && <span>Feedback</span>}
				</a>
				<button
					type="button"
					onClick={() => setCollapsed(!collapsed)}
					className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-foreground"
				>
					{collapsed ? (
						<ChevronsRight className="size-[18px] shrink-0" />
					) : (
						<ChevronsLeft className="size-[18px] shrink-0" />
					)}
					{!collapsed && <span>Collapse menu</span>}
				</button>
			</div>
		</aside>
	);
}

/** Neon's branch dropdown, scoped to databases. */
function DatabaseSwitcher({
	databases,
	active,
}: {
	databases: SidebarDatabase[];
	active: SidebarDatabase;
}) {
	const [open, setOpen] = useState(false);

	// With one database there is nothing to switch to, and a dropdown that only ever shows
	// the thing you are already looking at is noise.
	if (databases.length < 2) return null;

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex max-w-[130px] items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-sidebar-accent hover:text-foreground"
			>
				<span className="truncate">{active.name}</span>
				<ChevronsUpDown className="size-3 shrink-0" />
			</button>

			{open && (
				<>
					{/* Click-away layer, so closing needs no global listener. */}
					<button
						type="button"
						aria-label="Close database switcher"
						className="fixed inset-0 z-10 cursor-default"
						onClick={() => setOpen(false)}
					/>
					<div className="absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
						{databases.map((database) => (
							<Link
								key={database.id}
								href={`/databases/${database.id}`}
								onClick={() => setOpen(false)}
								className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
							>
								<span className="flex-1 truncate">{database.name}</span>
								{database.id === active.id && <Check className="size-3.5 shrink-0" />}
							</Link>
						))}
					</div>
				</>
			)}
		</div>
	);
}

function Section({
	label,
	collapsed,
	children,
}: {
	label: string;
	collapsed: boolean;
	children: React.ReactNode;
}) {
	return (
		<div>
			{!collapsed && (
				<p className="mb-2 px-3 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
					{label}
				</p>
			)}
			<div className="space-y-0.5">{children}</div>
		</div>
	);
}

function Item({
	item,
	pathname,
	collapsed,
}: {
	item: NavItem;
	pathname: string;
	collapsed: boolean;
}) {
	const Icon = item.icon;

	// Exact match, with one exception. A general prefix match would light up the database
	// Overview (/databases/:id) while you are on /databases/:id/monitoring, marking two
	// rows active at once — so only the workspace "Databases" row opts into prefix matching.
	const active =
		pathname === item.href || (item.href === "/databases" && pathname.startsWith("/databases/"));

	if (item.soon) {
		return (
			<span
				className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-muted-foreground/45 text-sm"
				title="Coming soon"
			>
				<Icon className="size-[18px] shrink-0" />
				{!collapsed && (
					<>
						<span>{item.label}</span>
						<span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
							soon
						</span>
					</>
				)}
			</span>
		);
	}

	return (
		<Link
			href={item.href}
			className={cn(
				"flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
				active
					? "bg-sidebar-accent font-medium text-foreground"
					: "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
			)}
		>
			<Icon className="size-[18px] shrink-0" />
			{!collapsed && <span>{item.label}</span>}
		</Link>
	);
}

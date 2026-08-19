"use client";

import {
	Activity,
	ChevronsLeft,
	ChevronsRight,
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
 * resource-scoped section, then utilities pinned to the bottom.
 *
 * The IA is the part worth copying — scoping navigation to the thing you are currently
 * looking at is what makes a console with this much surface area navigable. The palette
 * and copy are ours (PLAN.md Q10).
 *
 * Neon's second section is scoped to a branch. blaze has no branches, so it scopes to the
 * selected database instead — same shape, different noun.
 */

interface NavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	soon?: boolean;
}

const WORKSPACE: NavItem[] = [
	{ href: "/projects", label: "Overview", icon: LayoutGrid },
	{ href: "/databases", label: "Databases", icon: Database, soon: true },
	{ href: "/api-keys", label: "API keys", icon: KeyRound, soon: true },
	{ href: "/settings", label: "Settings", icon: Settings, soon: true },
];

const DATABASE: NavItem[] = [
	{ href: "/db/overview", label: "Overview", icon: Eye, soon: true },
	{ href: "/db/monitoring", label: "Monitoring", icon: Activity, soon: true },
	{ href: "/db/sql", label: "SQL Editor", icon: SquareTerminal, soon: true },
	{ href: "/db/tables", label: "Tables", icon: Table2, soon: true },
];

export function Sidebar() {
	const pathname = usePathname();
	const [collapsed, setCollapsed] = useState(false);

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

				<Section label="Database" collapsed={collapsed} className="mt-7">
					{DATABASE.map((item) => (
						<Item key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
					))}
				</Section>
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

function Section({
	label,
	collapsed,
	className,
	children,
}: {
	label: string;
	collapsed: boolean;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={className}>
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
	const active = pathname === item.href;
	const Icon = item.icon;

	// Unbuilt destinations render as disabled rather than being hidden: the shape of the
	// product is part of the information, and a link that 404s is worse than one that says
	// "soon" — that is precisely the bug that made sign-in dead-end on /projects.
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
			<Icon className={cn("size-[18px] shrink-0", active && "text-primary")} />
			{!collapsed && <span>{item.label}</span>}
		</Link>
	);
}

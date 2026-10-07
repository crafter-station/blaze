"use client";

import {
	BookOpen,
	Check,
	ChevronsUpDown,
	Database,
	Menu,
	MessageSquare,
	PanelLeftClose,
	PanelLeftOpen,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { EngineIcon } from "@/components/brand/engine-icon";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/toggle";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	currentDatabaseId,
	databaseNav,
	isActive,
	type NavItem,
	type SidebarDatabase,
	WORKSPACE_NAV,
} from "./nav";

const STORAGE_KEY = "blaze.sidebar.collapsed";
const WIDTH = { open: 240, collapsed: 56 };

/**
 * Desktop sidebar. Collapses to an icon rail; the choice is remembered per browser, which
 * is a convenience rather than state anyone else needs, so localStorage is the right home.
 * The width change is the one console transition driven by Motion, and it is instant under
 * prefers-reduced-motion.
 */
export function Sidebar({ databases }: { databases: SidebarDatabase[] }) {
	const [collapsed, setCollapsed] = useState(false);
	const reduceMotion = useReducedMotion();

	useEffect(() => {
		try {
			setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
		} catch {
			// Storage can be unavailable (private mode, blocked site data). Default is fine.
		}
	}, []);

	function toggle() {
		const next = !collapsed;
		setCollapsed(next);
		try {
			localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
		} catch {}
	}

	return (
		<motion.aside
			initial={false}
			animate={{ width: collapsed ? WIDTH.collapsed : WIDTH.open }}
			transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 42 }}
			className="sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-sidebar-border border-r bg-sidebar md:flex"
		>
			<div className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center" : "px-4")}>
				<Link
					href="/projects"
					aria-label="blaze home"
					className="rounded-md focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
				>
					{collapsed ? <Logo size="sm" className="[&>span]:hidden" /> : <Logo size="sm" />}
				</Link>
			</div>

			<SidebarNav databases={databases} collapsed={collapsed} />

			<div className="mt-auto space-y-0.5 border-sidebar-border border-t p-2">
				<FooterLink
					href="/docs"
					label="Documentation"
					icon={BookOpen}
					collapsed={collapsed}
					internal
				/>
				<FooterLink
					href="https://github.com/crafter-station/blaze/issues"
					label="Feedback"
					icon={MessageSquare}
					collapsed={collapsed}
				/>
				<SidebarTooltip label={collapsed ? "Expand sidebar" : undefined}>
					<button
						type="button"
						onClick={toggle}
						aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
						className={cn(
							"flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
							collapsed && "justify-center px-0",
						)}
					>
						{collapsed ? (
							<PanelLeftOpen className="size-4 shrink-0" strokeWidth={1.75} />
						) : (
							<PanelLeftClose className="size-4 shrink-0" strokeWidth={1.75} />
						)}
						{!collapsed && <span className="whitespace-nowrap">Collapse</span>}
					</button>
				</SidebarTooltip>
			</div>
		</motion.aside>
	);
}

/** Below `md` the sidebar becomes a sheet behind a menu button in the top bar. */
export function MobileNav({ databases }: { databases: SidebarDatabase[] }) {
	const [open, setOpen] = useState(false);
	const pathname = usePathname();

	// Close once navigation lands, rather than on click, so the sheet never closes on a
	// link that is still loading and leaves the user looking at the old page.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger.
	useEffect(() => setOpen(false), [pathname]);

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
					<Menu className="size-[18px]" />
				</Button>
			</SheetTrigger>
			<SheetContent side="left" className="w-[272px] gap-0 bg-sidebar p-0">
				<SheetTitle className="flex h-14 items-center px-4">
					<Logo size="sm" />
				</SheetTitle>
				<SidebarNav databases={databases} collapsed={false} />
				<div className="mt-auto space-y-0.5 border-sidebar-border border-t p-2">
					<FooterLink
						href="/docs"
						label="Documentation"
						icon={BookOpen}
						collapsed={false}
						internal
					/>
					<FooterLink
						href="https://github.com/crafter-station/blaze/issues"
						label="Feedback"
						icon={MessageSquare}
						collapsed={false}
					/>
					<div className="flex items-center justify-between px-2.5 pt-2 pb-1">
						<span className="text-muted-foreground text-xs">Theme</span>
						<ThemeToggle />
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}

function SidebarNav({
	databases,
	collapsed,
}: {
	databases: SidebarDatabase[];
	collapsed: boolean;
}) {
	const pathname = usePathname();
	const activeId = currentDatabaseId(pathname);
	const active = databases.find((d) => d.id === activeId) ?? null;

	return (
		<nav aria-label="Console" className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
			<SectionLabel collapsed={collapsed}>Workspace</SectionLabel>
			<ul className="space-y-0.5">
				{WORKSPACE_NAV.map((item) => (
					<li key={item.href}>
						<Item item={item} active={isActive(item.href, pathname)} collapsed={collapsed} />
					</li>
				))}
			</ul>

			<div className="mt-6">
				<SectionLabel collapsed={collapsed}>Database</SectionLabel>
				{databases.length > 0 ? (
					<DatabaseSwitcher databases={databases} active={active} collapsed={collapsed} />
				) : (
					!collapsed && (
						<p className="px-2.5 py-1.5 text-muted-foreground text-xs leading-relaxed">
							Create a database to see its overview, monitoring and editor here.
						</p>
					)
				)}

				{active && (
					<ul className="mt-1.5 space-y-0.5">
						{databaseNav(active).map((item) => (
							<li key={item.href}>
								<Item item={item} active={pathname === item.href} collapsed={collapsed} />
							</li>
						))}
					</ul>
				)}
			</div>
		</nav>
	);
}

function SectionLabel({ children, collapsed }: { children: string; collapsed: boolean }) {
	if (collapsed) return <div className="mx-auto mb-2 h-px w-5 bg-sidebar-border" />;
	return (
		<p className="mb-1.5 px-2.5 font-medium text-[0.6875rem] text-muted-foreground/80">
			{children}
		</p>
	);
}

function Item({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
	const Icon = item.icon;
	return (
		<SidebarTooltip label={collapsed ? item.label : undefined}>
			<Link
				href={item.href}
				aria-current={active ? "page" : undefined}
				className={cn(
					"relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring",
					active
						? "bg-sidebar-accent font-medium text-foreground"
						: "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
					collapsed && "justify-center px-0",
				)}
			>
				{/* "You are here" is one of the four jobs the accent is allowed. */}
				{active && (
					<span
						aria-hidden="true"
						className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-r-full bg-brand"
					/>
				)}
				<Icon className="size-4 shrink-0" strokeWidth={1.75} />
				{!collapsed && <span className="truncate whitespace-nowrap">{item.label}</span>}
			</Link>
		</SidebarTooltip>
	);
}

/** Neon's branch dropdown, scoped to databases. */
function DatabaseSwitcher({
	databases,
	active,
	collapsed,
}: {
	databases: SidebarDatabase[];
	active: SidebarDatabase | null;
	collapsed: boolean;
}) {
	return (
		<DropdownMenu>
			<SidebarTooltip label={collapsed ? (active?.name ?? "Choose a database") : undefined}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className={cn(
							"flex h-9 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background px-2.5 text-left text-[0.8125rem] shadow-xs transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:border-border-strong",
							collapsed && "justify-center border-transparent bg-transparent px-0 shadow-none",
						)}
						aria-label="Switch database"
					>
						{active ? (
							<EngineIcon engine={active.engine} className="size-3.5 text-foreground/80" />
						) : (
							<Database className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
						)}
						{!collapsed && (
							<>
								<span
									className={cn(
										"flex-1 truncate",
										active ? "font-medium" : "text-muted-foreground",
									)}
								>
									{active ? active.name : "Choose a database"}
								</span>
								<ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
							</>
						)}
					</button>
				</DropdownMenuTrigger>
			</SidebarTooltip>
			<DropdownMenuContent align="start" side={collapsed ? "right" : "bottom"} className="w-56">
				<DropdownMenuLabel className="text-muted-foreground text-xs">Databases</DropdownMenuLabel>
				{databases.map((database) => (
					<DropdownMenuItem key={database.id} asChild>
						<Link href={`/databases/${database.id}`} className="gap-2">
							<EngineIcon engine={database.engine} className="size-3.5 text-muted-foreground" />
							<span className="flex-1 truncate">{database.name}</span>
							{database.id === active?.id && <Check className="size-3.5 text-brand-text" />}
						</Link>
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/databases" className="text-muted-foreground">
						All databases
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function FooterLink({
	href,
	label,
	icon: Icon,
	collapsed,
	internal,
}: {
	href: string;
	label: string;
	icon: NavItem["icon"];
	collapsed: boolean;
	internal?: boolean;
}) {
	const className = cn(
		"flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
		collapsed && "justify-center px-0",
	);
	const content = (
		<>
			<Icon className="size-4 shrink-0" strokeWidth={1.75} />
			{!collapsed && <span className="whitespace-nowrap">{label}</span>}
		</>
	);
	return (
		<SidebarTooltip label={collapsed ? label : undefined}>
			{internal ? (
				<Link href={href} className={className}>
					{content}
				</Link>
			) : (
				<a href={href} target="_blank" rel="noreferrer" className={className}>
					{content}
				</a>
			)}
		</SidebarTooltip>
	);
}

/** Tooltips only exist on the collapsed rail, where the label is otherwise missing. */
function SidebarTooltip({ label, children }: { label?: string; children: React.ReactElement }) {
	if (!label) return children;
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side="right" sideOffset={8}>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

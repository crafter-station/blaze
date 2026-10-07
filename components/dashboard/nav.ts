import {
	Activity,
	Database,
	Gauge,
	KeyRound,
	LayoutGrid,
	type LucideIcon,
	Settings,
	SquareTerminal,
	Table2,
} from "lucide-react";
import { ENGINE_CONFIG, type Engine } from "@/lib/engines/types";

/**
 * Console navigation, following Neon's information architecture: a workspace-scoped
 * section, then a section scoped to the resource you are inside. Neon scopes the second
 * section to a branch; blaze has no branches, so it scopes to a database.
 */

export interface SidebarDatabase {
	id: string;
	name: string;
	engine: Engine;
}

export interface NavItem {
	href: string;
	label: string;
	icon: LucideIcon;
}

export const WORKSPACE_NAV: NavItem[] = [
	{ href: "/projects", label: "Overview", icon: LayoutGrid },
	{ href: "/databases", label: "Databases", icon: Database },
	{ href: "/api-keys", label: "API keys", icon: KeyRound },
	{ href: "/settings", label: "Settings", icon: Settings },
];

/** Mongo and Redis have no SQL editor (PLAN.md Q18), so the row is not offered. */
export function databaseNav(database: SidebarDatabase): NavItem[] {
	const base = `/databases/${database.id}`;
	return [
		{ href: base, label: "Overview", icon: Gauge },
		{ href: `${base}/monitoring`, label: "Monitoring", icon: Activity },
		...(ENGINE_CONFIG[database.engine].hasSql
			? [{ href: `${base}/sql`, label: "SQL editor", icon: SquareTerminal }]
			: []),
		{ href: `${base}/tables`, label: "Tables", icon: Table2 },
	];
}

/** `/databases/db_x7f2/monitoring` -> `db_x7f2`; anything else -> null. */
export function currentDatabaseId(pathname: string): string | null {
	const match = pathname.match(/^\/databases\/([^/]+)/);
	return match ? match[1] : null;
}

/**
 * Exact match, with one exception: the workspace "Databases" row also lights up inside
 * a database. A general prefix match would mark the database Overview active while on
 * its Monitoring page, two rows at once.
 */
export function isActive(href: string, pathname: string): boolean {
	return pathname === href || (href === "/databases" && pathname.startsWith("/databases/"));
}

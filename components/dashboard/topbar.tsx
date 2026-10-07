"use client";

import { UserButton } from "@clerk/nextjs";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { ThemeToggle } from "@/components/theme/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { currentDatabaseId, type SidebarDatabase } from "./nav";
import { MobileNav } from "./sidebar";

const SECTION: Record<string, string> = {
	projects: "Overview",
	databases: "Databases",
	"api-keys": "API keys",
	settings: "Settings",
};

const DATABASE_PAGE: Record<string, string> = {
	monitoring: "Monitoring",
	sql: "SQL editor",
	tables: "Tables",
};

function crumbs(pathname: string, databases: SidebarDatabase[]) {
	const [section, , page] = pathname.split("/").filter(Boolean);
	const list: { label: string; href?: string }[] = [];
	if (SECTION[section]) list.push({ label: SECTION[section], href: `/${section}` });

	const id = currentDatabaseId(pathname);
	if (id) {
		const name = databases.find((d) => d.id === id)?.name ?? id;
		list.push({ label: name, href: `/databases/${id}` });
		if (page && DATABASE_PAGE[page]) list.push({ label: DATABASE_PAGE[page] });
	}
	return list;
}

/**
 * Top bar in Neon's shape: workspace scope and where you are on the left; health, theme
 * and account on the right.
 *
 * The status indicator is real: it reflects the control plane, not a decoration. A console
 * that always says "All OK" teaches people to stop reading it.
 */
export function TopBar({
	workspace,
	plan,
	healthy,
	databases,
}: {
	workspace: string;
	plan: string;
	healthy: boolean;
	databases: SidebarDatabase[];
}) {
	const pathname = usePathname();
	const trail = crumbs(pathname, databases);

	return (
		<header className="sticky top-0 z-30 border-border border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
			<div className="flex h-14 items-center gap-3 px-3 sm:px-4 lg:px-6">
				<MobileNav databases={databases} />

				<nav aria-label="Breadcrumb" className="flex min-w-0 items-center text-sm">
					<ol className="flex min-w-0 items-center gap-1.5">
						<li className="flex shrink-0 items-center gap-2">
							<span className="flex size-5 items-center justify-center rounded-[5px] bg-foreground font-semibold text-[0.6875rem] text-background uppercase">
								{workspace.slice(0, 1)}
							</span>
							<span className="hidden max-w-[160px] truncate font-medium sm:inline">
								{workspace}
							</span>
							<span className="hidden rounded-sm border border-border px-1 py-px font-medium text-[0.625rem] text-muted-foreground uppercase tracking-wider sm:inline">
								{plan}
							</span>
						</li>
						{trail.map((crumb, index) => {
							const last = index === trail.length - 1;
							return (
								<Fragment key={crumb.label}>
									<li aria-hidden="true" className="text-muted-foreground/50">
										<ChevronRight className="size-3.5" />
									</li>
									<li className={cn("min-w-0", !last && "hidden sm:block")}>
										{crumb.href && !last ? (
											<Link
												href={crumb.href}
												className="block truncate text-muted-foreground transition-colors hover:text-foreground"
											>
												{crumb.label}
											</Link>
										) : (
											<span aria-current="page" className="block truncate font-medium">
												{crumb.label}
											</span>
										)}
									</li>
								</Fragment>
							);
						})}
					</ol>
				</nav>

				<div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
					<Tooltip>
						<TooltipTrigger asChild>
							<span
								className={cn(
									"inline-flex h-7 cursor-default items-center gap-2 rounded-full border px-2.5 text-xs",
									healthy
										? "border-border text-muted-foreground"
										: "border-destructive/30 bg-destructive/10 text-destructive",
								)}
							>
								<span className="relative flex size-1.5">
									<span
										className={cn(
											"absolute inline-flex size-full rounded-full opacity-50",
											healthy ? "bg-success" : "animate-ping bg-destructive",
										)}
									/>
									<span
										className={cn(
											"relative inline-flex size-1.5 rounded-full",
											healthy ? "bg-success" : "bg-destructive",
										)}
									/>
								</span>
								<span className="hidden sm:inline">{healthy ? "Operational" : "Degraded"}</span>
							</span>
						</TooltipTrigger>
						<TooltipContent>
							{healthy ? "Control plane is reachable" : "Control plane is not responding"}
						</TooltipContent>
					</Tooltip>

					<ThemeToggle className="hidden sm:inline-flex" />

					<UserButton
						appearance={{ elements: { avatarBox: "!size-7", userButtonTrigger: "!rounded-full" } }}
					/>
				</div>
			</div>
		</header>
	);
}

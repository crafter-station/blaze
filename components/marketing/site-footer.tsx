import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/toggle";

const LINKS = [
	{ href: "/docs", label: "Docs" },
	{ href: "/docs#quickstart", label: "Quickstart" },
	{ href: "/docs#mcp", label: "MCP server" },
	{ href: "/waitlist", label: "Waitlist" },
	{ href: "/sign-in", label: "Sign in" },
];

export function SiteFooter() {
	return (
		<footer className="border-border border-t">
			<div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
				<div className="space-y-2">
					<Logo size="sm" />
					<p className="text-muted-foreground text-sm">
						Any database in 200ms. Free while in alpha.
					</p>
				</div>
				<nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
					{LINKS.map((link) => (
						<Link
							key={link.href}
							href={link.href}
							className="text-muted-foreground transition-colors hover:text-foreground"
						>
							{link.label}
						</Link>
					))}
					<a
						href="https://github.com/crafter-station/blaze"
						target="_blank"
						rel="noreferrer"
						className="text-muted-foreground transition-colors hover:text-foreground"
					>
						GitHub
					</a>
				</nav>
				<ThemeToggle />
			</div>
		</footer>
	);
}

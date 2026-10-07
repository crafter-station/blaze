import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/toggle";

const LINKS = [
	{ href: "/docs", label: "Docs" },
	{ href: "/docs/security", label: "Security" },
	{ href: "/docs/limits", label: "Limits" },
];

/** One row: mark, a few links, the theme control. Wraps to two lines on a phone. */
export function SiteFooter() {
	return (
		<footer className="border-border border-t">
			<div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-8 gap-y-4 px-4 py-6 sm:px-6">
				<Logo size="sm" />
				<nav
					aria-label="Footer"
					className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground text-sm"
				>
					{LINKS.map((link) => (
						<Link
							key={link.href}
							href={link.href}
							className="transition-colors hover:text-foreground"
						>
							{link.label}
						</Link>
					))}
					<a
						href="https://github.com/crafter-station/blaze"
						target="_blank"
						rel="noreferrer"
						className="transition-colors hover:text-foreground"
					>
						GitHub
					</a>
				</nav>
				<ThemeToggle className="ml-auto" />
			</div>
		</footer>
	);
}

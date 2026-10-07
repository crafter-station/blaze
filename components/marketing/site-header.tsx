import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/**
 * Marketing header. Not sticky: the landing page is two screens long, so there is
 * nothing to keep in reach. One line at every width.
 */
export function SiteHeader() {
	return (
		<header>
			<div className="mx-auto flex h-16 max-w-[1120px] items-center gap-2 px-4 sm:px-6">
				<Link
					href="/"
					aria-label="blaze home"
					className="mr-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
				>
					<Logo size="sm" />
				</Link>
				<nav aria-label="Main" className="flex items-center gap-1 text-sm">
					<HeaderLink href="/docs">Docs</HeaderLink>
					<HeaderLink href="/sign-in">Sign in</HeaderLink>
				</nav>
				<Button size="sm" asChild className="ml-1 sm:ml-2">
					<Link href="/waitlist">Join the waitlist</Link>
				</Button>
			</div>
		</header>
	);
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<Link
			href={href}
			className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
		>
			{children}
		</Link>
	);
}

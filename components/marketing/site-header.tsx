import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/**
 * Marketing header. Sticky, translucent, single line at every width: the nav collapses to
 * the two actions that matter on small screens rather than wrapping.
 */
export function SiteHeader() {
	return (
		<header className="sticky top-0 z-40 border-border/60 border-b bg-background/75 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
			<div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
				<Link
					href="/"
					aria-label="blaze home"
					className="rounded-md focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
				>
					<Logo size="sm" />
				</Link>
				<nav aria-label="Main" className="hidden items-center gap-1 text-sm md:flex">
					<HeaderLink href="/#engines">Engines</HeaderLink>
					<HeaderLink href="/#provision">How it works</HeaderLink>
					<HeaderLink href="/#limits">Limits</HeaderLink>
					<HeaderLink href="/docs">Docs</HeaderLink>
				</nav>
				<div className="ml-auto flex items-center gap-2">
					<Button variant="ghost" size="sm" asChild>
						<Link href="/sign-in">Sign in</Link>
					</Button>
					<Button size="sm" asChild>
						<Link href="/waitlist">Join the waitlist</Link>
					</Button>
				</div>
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

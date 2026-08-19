import Link from "next/link";
import { GridBackdrop } from "@/components/grid-backdrop";
import { PromptButton } from "@/components/prompt-button";
import { LIMITS } from "@/lib/limits";
import { setupPrompt } from "@/lib/setup-prompt";

/**
 * Landing page — one viewport, no scroll.
 *
 * Everything that was explanatory now lives in /docs. What is left is the claim, a single
 * sentence of context, and the one action worth taking. A landing page that has to be
 * scrolled is one that did not trust its own first screen.
 *
 * Still no testimonials and no logo wall (PLAN.md Q21): blaze has no customers, and
 * fabricated social proof on a database product destroys exactly the trust needed for
 * someone to hand it their data.
 */
export default function Home() {
	return (
		<>
			<GridBackdrop />
			{/*
			 * `h-dvh` rather than `h-screen`: on mobile the browser chrome makes 100vh taller
			 * than the visible area, which is precisely how a "no scroll" page ends up
			 * scrolling by exactly the height of the address bar.
			 */}
			<main className="flex h-dvh flex-col overflow-hidden px-6">
				<header className="flex shrink-0 items-center justify-between py-6">
					<span className="font-display font-bold text-lg">blaze</span>
					<nav className="flex items-center gap-5 text-sm">
						<Link
							href="/docs"
							className="text-muted-foreground transition-colors hover:text-foreground"
						>
							Docs
						</Link>
						<Link
							href="/sign-in"
							className="text-muted-foreground transition-colors hover:text-foreground"
						>
							Sign in
						</Link>
						<Link
							href="/sign-up"
							className="rounded-lg border border-border px-3 py-1.5 transition-colors hover:bg-accent"
						>
							Create account
						</Link>
					</nav>
				</header>

				<div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-7 pb-16">
					<h1 className="font-semibold text-[clamp(2.5rem,7vw,4rem)] leading-[1.05] tracking-tight">
						Any database in <span className="font-mono">200ms</span>.
					</h1>

					<p className="max-w-xl text-balance text-lg text-muted-foreground leading-relaxed">
						Free managed Postgres for agents and the people who build them — created, queried and
						thrown away straight from your AI client, with no key to copy.
					</p>

					<PromptButton prompt={setupPrompt()} />

					<p className="text-muted-foreground text-xs">
						Works with Claude Code, Claude Desktop, ChatGPT and Codex · {LIMITS.DATABASES_PER_USER}{" "}
						databases, {LIMITS.STORAGE_BYTES / 1024 / 1024}&nbsp;MB each, free while in alpha
					</p>
				</div>
			</main>
		</>
	);
}

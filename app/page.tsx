import Link from "next/link";
import { ENGINE_CONFIG, ENGINES } from "@/lib/engines/types";

/**
 * Placeholder. The real landing page is step 9 — hero, engine grid, the three
 * differentiators, honest limits, docs. Explicitly no testimonials and no logo wall
 * (PLAN.md Q21).
 */
export default function Home() {
	return (
		<main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6">
			<div className="space-y-4">
				<h1 className="font-semibold text-5xl tracking-tight">
					Any database in <span className="font-mono">200ms</span>.
				</h1>
				<p className="max-w-xl text-lg text-muted-foreground">
					Free managed databases for agents and the people who build them. Provision from an API, an
					MCP server, or the dashboard.
				</p>
			</div>

			<ul className="flex flex-wrap gap-2">
				{ENGINES.map((engine) => (
					<li
						key={engine}
						className="rounded-md border border-border bg-card px-3 py-1.5 text-muted-foreground text-sm"
					>
						{ENGINE_CONFIG[engine].label}
					</li>
				))}
			</ul>

			<div className="flex gap-3">
				<Link
					href="/sign-up"
					className="rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
				>
					Get started
				</Link>
				<Link
					href="/sign-in"
					className="rounded-lg border border-border px-4 py-2.5 font-medium text-sm transition-colors hover:bg-accent"
				>
					Sign in
				</Link>
			</div>

			<p className="text-muted-foreground text-sm">
				Free while in alpha — 5 databases, 500&nbsp;MB each.
			</p>
		</main>
	);
}

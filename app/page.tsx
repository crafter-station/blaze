import { Terminal } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { GridBackdrop } from "@/components/grid-backdrop";
import { ENGINE_CONFIG, ENGINES } from "@/lib/engines/types";
import { setupPrompt } from "@/lib/setup-prompt";

export default function Home() {
	const prompt = setupPrompt();

	return (
		<>
			<GridBackdrop />
			<main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-20">
				<div className="space-y-4">
					<h1 className="font-semibold text-5xl tracking-tight">
						Any database in <span className="font-mono">200ms</span>.
					</h1>
					<p className="max-w-xl text-base text-muted-foreground">
						Free managed databases for agents and the people who build them. Provision from an API,
						an MCP server, or the dashboard.
					</p>
				</div>

				{/*
				 * The prompt sits above the sign-up button on purpose: the fastest way to understand
				 * what blaze is, is watching your own agent wire it up and hand back a working
				 * connection string.
				 */}
				<div className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur">
					<div className="flex items-center justify-between gap-3 border-border border-b px-4 py-2.5">
						<span className="inline-flex items-center gap-2 text-muted-foreground text-xs">
							<Terminal className="size-3.5" />
							Paste into Claude Code to set everything up
						</span>
						<CopyButton value={prompt} label="Copy prompt" />
					</div>
					<pre className="max-h-52 overflow-auto whitespace-pre-wrap px-4 py-3 text-[12.5px] text-muted-foreground leading-relaxed">
						{prompt}
					</pre>
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

				<div className="flex flex-wrap gap-3">
					<Link
						href="/sign-up"
						className="rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
					>
						Get an API key
					</Link>
					<Link
						href="/docs"
						className="rounded-lg border border-border px-4 py-2.5 font-medium text-sm transition-colors hover:bg-accent"
					>
						Docs
					</Link>
					<Link
						href="/sign-in"
						className="rounded-lg px-4 py-2.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
					>
						Sign in
					</Link>
				</div>

				<p className="text-muted-foreground text-sm">
					Free while in alpha — 5 databases, 500&nbsp;MB each. PostgreSQL today; the rest are on the
					way.
				</p>
			</main>
		</>
	);
}

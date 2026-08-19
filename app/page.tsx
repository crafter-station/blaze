import { Boxes, KeyRound, Terminal, Zap } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { GridBackdrop } from "@/components/grid-backdrop";
import { ENGINE_CONFIG, ENGINES } from "@/lib/engines/types";
import { LIMITS } from "@/lib/limits";
import { setupPrompt } from "@/lib/setup-prompt";

/**
 * Landing page.
 *
 * Structure per PLAN.md Q21: hero, the paste-to-configure prompt, engines, the three
 * differentiators that are actually true, and the limits stated plainly. Explicitly no
 * testimonials and no logo wall — blaze has no customers, and fabricated social proof on
 * a database product destroys exactly the trust needed to hand it your data.
 */

const CLIENTS = ["Claude Code", "Claude Desktop", "ChatGPT", "Codex"];

const DIFFERENTIATORS = [
	{
		icon: Zap,
		title: "200ms, measured",
		body: "Databases are created inside a running Postgres cluster, not by booting a container. The dashboard shows the real number on every create.",
	},
	{
		icon: Boxes,
		title: "Six engines, one control plane",
		body: "PostgreSQL today; MySQL, MariaDB, MongoDB, Redis and libSQL share the same API and dashboard as they land.",
	},
	{
		icon: KeyRound,
		title: "Agent-native, no key to copy",
		body: "The MCP server authorizes over OAuth. Your agent registers itself, you approve once, and it can create and query databases directly.",
	},
];

export default function Home() {
	const prompt = setupPrompt();

	return (
		<>
			<GridBackdrop />
			<main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-12 px-6 py-24">
				<div className="space-y-4">
					<h1 className="font-semibold text-5xl tracking-tight">
						Any database in <span className="font-mono">200ms</span>.
					</h1>
					<p className="max-w-xl text-base text-muted-foreground">
						Free managed databases for agents and the people who build them. Provision from an MCP
						server, a REST API, or the dashboard.
					</p>
				</div>

				{/*
				 * The prompt sits above the sign-up button on purpose: the fastest way to understand
				 * blaze is watching your own agent wire it up and hand back a working connection
				 * string — no account needed to read it, no key needed to use it.
				 */}
				<div className="space-y-3">
					<div className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur">
						<div className="flex items-center justify-between gap-3 border-border border-b px-4 py-2.5">
							<span className="inline-flex items-center gap-2 text-muted-foreground text-xs">
								<Terminal className="size-3.5" />
								Paste into your agent — it configures itself
							</span>
							<CopyButton value={prompt} label="Copy prompt" />
						</div>
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap px-4 py-3 text-[12.5px] text-muted-foreground leading-relaxed">
							{prompt}
						</pre>
					</div>
					<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
						<span>Works with</span>
						{CLIENTS.map((client) => (
							<span key={client} className="rounded border border-border px-1.5 py-0.5">
								{client}
							</span>
						))}
						<span>— or anything speaking MCP over HTTP.</span>
					</p>
				</div>

				<div className="grid gap-4 sm:grid-cols-3">
					{DIFFERENTIATORS.map((item) => (
						<div
							key={item.title}
							className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur"
						>
							<item.icon className="mb-3 size-[18px] text-foreground" />
							<p className="font-medium text-sm">{item.title}</p>
							<p className="mt-1.5 text-muted-foreground text-xs leading-relaxed">{item.body}</p>
						</div>
					))}
				</div>

				<div className="space-y-3">
					<p className="text-muted-foreground text-xs uppercase tracking-wider">Engines</p>
					<ul className="flex flex-wrap gap-2">
						{ENGINES.map((engine) => {
							const live = engine === "postgres";
							return (
								<li
									key={engine}
									className={
										live
											? "rounded-md border border-border bg-card px-3 py-1.5 text-sm"
											: "rounded-md border border-border border-dashed px-3 py-1.5 text-muted-foreground/60 text-sm"
									}
								>
									{ENGINE_CONFIG[engine].label}
									{!live && <span className="ml-1.5 text-[10px]">soon</span>}
								</li>
							);
						})}
					</ul>
				</div>

				<div className="flex flex-wrap gap-3">
					<Link
						href="/sign-up"
						className="rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
					>
						Create an account
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
					Free while in alpha — {LIMITS.DATABASES_PER_USER} databases,{" "}
					{LIMITS.STORAGE_BYTES / 1024 / 1024}&nbsp;MB each, no card. Connections require TLS.
				</p>
			</main>
		</>
	);
}

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { EngineIcon } from "@/components/brand/engine-icon";
import { CopyButton } from "@/components/copy-button";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { Button } from "@/components/ui/button";
import { PROVISIONABLE } from "@/lib/engines/available";
import { ENGINE_CONFIG, ENGINES } from "@/lib/engines/types";
import { LIMITS } from "@/lib/limits";
import { MCP_URL } from "@/lib/setup-prompt";

/**
 * Landing page. Deliberately short: a hero, three quiet facts and a way in. Everything
 * else (isolation, every limit, the REST API, the dashboard) lives in /docs.
 *
 * Every claim is checkable against the code: the engine list and availability come from
 * the provisioner's own list, the limits from lib/limits.ts, the snippet from /docs.
 * No testimonials and no logo wall (PLAN.md Q21): blaze has no customers yet, and
 * fabricated social proof on a database product destroys exactly the trust needed for
 * someone to hand it their data.
 */

const MCP_COMMAND = `claude mcp add --transport http blaze ${MCP_URL}`;

const MB = 1024 * 1024;
const LIMIT_LINE = [
	"Free in alpha",
	`${LIMITS.DATABASES_PER_USER} databases`,
	`${LIMITS.STORAGE_BYTES / MB} MB each`,
	`${LIMITS.REDIS_MEMORY_BYTES / MB} MB Redis`,
	"TLS only",
];

/** Live engines first, then the ones that are built but not offered yet. */
const ENGINE_ROW = [
	...ENGINES.filter((engine) => PROVISIONABLE.includes(engine)),
	...ENGINES.filter((engine) => !PROVISIONABLE.includes(engine)),
];

const CONTAINER = "mx-auto max-w-[1120px] px-4 sm:px-6";

export default function Home() {
	return (
		<div className="min-h-dvh">
			<a
				href="#main"
				className="sr-only rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus-visible:outline-2 focus-visible:outline-ring"
			>
				Skip to content
			</a>
			<SiteHeader />
			<main id="main">
				<Hero />
				<Block title="Engines">
					<EngineRow />
				</Block>
				<Block title="Connect">
					<Snippet />
				</Block>
				<Block title="Limits">
					<LimitsLine />
				</Block>
				<Closing />
			</main>
			<SiteFooter />
		</div>
	);
}

function Hero() {
	return (
		<section aria-labelledby="hero-title" className={CONTAINER}>
			<div className="grid items-center gap-12 pt-14 pb-20 sm:pt-20 lg:grid-cols-12 lg:gap-8 lg:pt-24 lg:pb-36">
				<div className="lg:col-span-6">
					<h1
						id="hero-title"
						className="text-balance font-semibold text-[2.75rem] leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-[4.75rem]"
					>
						Any database
						<br />
						in <span className="text-brand-text">200ms</span>.
					</h1>
					<p className="mt-6 max-w-[26rem] text-lg text-muted-foreground leading-relaxed">
						Free managed databases for agents and their builders, created from an API, an MCP server
						or the dashboard.
					</p>
					<div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
						<Button size="xl" asChild>
							<Link href="/waitlist">
								Join the waitlist
								<ArrowRight data-icon="inline-end" />
							</Link>
						</Button>
						<Link
							href="/docs"
							className="rounded-sm text-[0.9375rem] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
						>
							Read the docs
						</Link>
					</div>
				</div>
				<div className="min-w-0 lg:col-span-6">
					<HeroDemo />
				</div>
			</div>
		</section>
	);
}

/** One fact per row: a quiet label on the left, the fact on the right, hairline above. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
	const id = `${title.toLowerCase()}-title`;
	return (
		<section aria-labelledby={id} className={CONTAINER}>
			<div className="grid gap-4 border-border border-t py-12 lg:items-baseline sm:py-14 lg:grid-cols-12 lg:py-20 lg:gap-8">
				<h2 id={id} className="pt-0.5 text-muted-foreground text-sm lg:col-span-3">
					{title}
				</h2>
				<div className="min-w-0 lg:col-span-9">{children}</div>
			</div>
		</section>
	);
}

function EngineRow() {
	return (
		<ul className="flex flex-wrap gap-x-8 gap-y-4">
			{ENGINE_ROW.map((engine) => {
				const live = PROVISIONABLE.includes(engine);
				return (
					<li
						key={engine}
						className={
							live
								? "flex items-baseline gap-2.5 text-foreground"
								: "flex items-baseline gap-2.5 text-muted-foreground/70"
						}
					>
						<EngineIcon engine={engine} className="size-[1.125rem] self-center" />
						<span className="text-[0.9375rem]">{ENGINE_CONFIG[engine].label}</span>
						{!live && (
							<span className="font-mono text-[0.6875rem] text-muted-foreground/70">soon</span>
						)}
					</li>
				);
			})}
		</ul>
	);
}

function Snippet() {
	return (
		<div>
			<div className="flex items-center gap-3 rounded-lg bg-[var(--code-background)] py-2 pr-2 pl-4 ring-1 ring-border ring-inset">
				<code
					translate="no"
					className="min-w-0 flex-1 break-words py-1 font-mono text-[0.8125rem] leading-relaxed"
				>
					<span className="mr-2 select-none text-muted-foreground">$</span>
					{MCP_COMMAND}
				</code>
				<CopyButton value={MCP_COMMAND} label="Copy command" iconOnly />
			</div>
			<p className="mt-4 text-muted-foreground text-sm leading-relaxed">
				Claude Code finds blaze over OAuth and asks you to approve once in the browser. No key to
				paste. Other ways in:{" "}
				<Link
					href="/docs/quickstart"
					className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
				>
					REST API
				</Link>
				,{" "}
				<Link
					href="/docs"
					className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
				>
					dashboard
				</Link>
				.
			</p>
		</div>
	);
}

function LimitsLine() {
	return (
		<div>
			{/* Separators sit in the gap before each item; the list is pulled left by one gap and
			    clipped, so a separator that wraps to the start of a line is hidden. */}
			<div className="overflow-hidden">
				<ul className="-ml-6 flex flex-wrap gap-y-1 text-[1.0625rem] leading-relaxed">
					{LIMIT_LINE.map((item) => (
						<li key={item} className="relative whitespace-nowrap pl-6">
							<span
								aria-hidden="true"
								className="absolute left-0 w-6 text-center text-muted-foreground/60"
							>
								·
							</span>
							{item}
						</li>
					))}
				</ul>
			</div>
			<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
				No backups yet, so treat alpha databases as somewhere to build and test.
			</p>
			<p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
				<ArrowLink href="/docs/limits">All limits</ArrowLink>
				<ArrowLink href="/docs/security">How tenants are isolated</ArrowLink>
			</p>
		</div>
	);
}

function ArrowLink({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<Link
			href={href}
			className="inline-flex items-center gap-1 rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
		>
			{children}
			<ArrowRight className="size-3.5 text-muted-foreground" />
		</Link>
	);
}

function Closing() {
	return (
		<section aria-labelledby="closing-title" className={CONTAINER}>
			<div className="flex flex-col gap-6 border-border border-t py-16 sm:flex-row sm:items-center sm:justify-between sm:py-20 lg:py-28">
				<h2
					id="closing-title"
					className="max-w-2xl text-balance font-semibold text-2xl tracking-[-0.03em] sm:text-[1.75rem]"
				>
					In private alpha, letting people in a few at a time.
				</h2>
				<Button size="xl" asChild className="self-start sm:self-auto">
					<Link href="/waitlist">
						Join the waitlist
						<ArrowRight data-icon="inline-end" />
					</Link>
				</Button>
			</div>
		</section>
	);
}

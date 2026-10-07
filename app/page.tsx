import {
	ArrowRight,
	Fingerprint,
	Globe,
	KeyRound,
	Lock,
	ServerCog,
	ShieldCheck,
	Split,
} from "lucide-react";
import Link from "next/link";
import { EngineIcon } from "@/components/brand/engine-icon";
import { Isotype } from "@/components/brand/logo";
import { CodeBlock } from "@/components/code-block";
import { ConnectionString } from "@/components/connection-string";
import { GridBackdrop } from "@/components/grid-backdrop";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { PromptButton } from "@/components/prompt-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROVISIONABLE } from "@/lib/engines/available";
import { ENGINE_CONFIG, ENGINES, type Engine } from "@/lib/engines/types";
import { formatBytes } from "@/lib/format";
import { LIMITS, METRICS_INTERVAL_MS, TTL } from "@/lib/limits";
import { MCP_URL, setupPrompt } from "@/lib/setup-prompt";

/**
 * Landing page.
 *
 * Every claim on it is checkable against the code: limits come from lib/limits.ts, the
 * engine list and availability from the provisioner's own list, snippets from /docs.
 * Still no testimonials and no logo wall (PLAN.md Q21): blaze has no customers, and
 * fabricated social proof on a database product destroys exactly the trust needed for
 * someone to hand it their data.
 */

const ENGINE_NOTES: Record<Engine, string> = {
	postgres: "Its own database and role on a shared instance.",
	mysql: "Its own database and user on a shared instance.",
	mariadb: "Its own database and user on a shared instance.",
	mongo: "Driver and provisioner written, not yet offered.",
	redis: "One container per tenant, TLS only, routed by SNI.",
	libsql: "Dedicated container while namespaces are evaluated.",
};

export default function Home() {
	return (
		<div className="min-h-dvh">
			<SiteHeader />
			<main id="main">
				<Hero />
				<Engines />
				<Provision />
				<Limits />
				<Security />
				<WaitlistCta />
			</main>
			<SiteFooter />
		</div>
	);
}

function Hero() {
	return (
		<section className="relative isolate overflow-hidden">
			<GridBackdrop />
			<div className="mx-auto grid max-w-[1200px] items-center gap-14 px-4 pt-16 pb-20 sm:px-6 md:pt-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:gap-16 lg:pb-28">
				<div>
					<Reveal>
						<Link
							href="/waitlist"
							className="group inline-flex items-center gap-2 rounded-full border border-border bg-background/70 py-1 pr-3 pl-1 text-muted-foreground text-xs backdrop-blur transition-colors hover:border-border-strong hover:text-foreground"
						>
							<span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand-text">
								Private alpha
							</span>
							Free while it lasts
							<ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
						</Link>
					</Reveal>
					<Reveal delay={0.06}>
						<h1 className="mt-6 font-semibold text-[2.75rem] leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-[4.25rem]">
							Any database
							<br />
							in{" "}
							<span className="font-mono font-medium text-brand-text tracking-[-0.06em]">
								200ms
							</span>
							.
						</h1>
					</Reveal>
					<Reveal delay={0.12}>
						<p className="mt-6 max-w-[30rem] text-lg text-muted-foreground leading-relaxed">
							Free managed databases for agents and their builders, created from an API, an MCP
							server or the dashboard.
						</p>
					</Reveal>
					<Reveal delay={0.18}>
						<div className="mt-9 flex flex-wrap items-center gap-3">
							<Button size="xl" asChild>
								<Link href="/waitlist">
									Join the waitlist
									<ArrowRight data-icon="inline-end" />
								</Link>
							</Button>
							<Button size="xl" variant="ghost" asChild>
								<Link href="/docs">Read the docs</Link>
							</Button>
						</div>
					</Reveal>
				</div>
				<Reveal delay={0.2}>
					<HeroDemo />
				</Reveal>
			</div>
		</section>
	);
}

function SectionHeading({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children?: React.ReactNode;
}) {
	return (
		<Reveal className="max-w-2xl">
			<h2 id={id} className="font-semibold text-3xl tracking-[-0.03em] sm:text-4xl">
				{title}
			</h2>
			{children && (
				<p className="mt-4 text-base text-muted-foreground leading-relaxed sm:text-lg">
					{children}
				</p>
			)}
		</Reveal>
	);
}

function Engines() {
	return (
		<section
			id="engines"
			aria-labelledby="engines-title"
			className="scroll-mt-20 border-border border-t"
		>
			<div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:py-28">
				<SectionHeading id="engines-title" title="Six engines, one connection string away.">
					Relational, document, key-value and edge SQLite. {PROVISIONABLE.length} are live today;
					the rest are built and waiting on their isolation story.
				</SectionHeading>

				<ul className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-3">
					{ENGINES.map((engine, index) => {
						const config = ENGINE_CONFIG[engine];
						const live = PROVISIONABLE.includes(engine);
						return (
							<Reveal as="li" key={engine} delay={index * 0.04} className="group bg-card">
								<div className="flex h-full flex-col gap-6 p-4 transition-colors sm:p-6 duration-300 group-hover:bg-accent/40">
									<div className="flex items-start justify-between gap-4">
										<span
											className={
												live
													? "flex size-11 items-center justify-center rounded-xl border border-border bg-background text-foreground shadow-xs"
													: "flex size-11 items-center justify-center rounded-xl border border-border border-dashed text-muted-foreground"
											}
										>
											<EngineIcon engine={engine} className="size-5" />
										</span>
										{live ? (
											<Badge variant="success">Available</Badge>
										) : (
											<Badge variant="outline">Coming soon</Badge>
										)}
									</div>
									<div className="mt-auto">
										<p className="font-medium text-[1.0625rem] tracking-[-0.01em]">
											{config.label}
										</p>
										<p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
											{ENGINE_NOTES[engine]}
										</p>
										<p className="mt-4 font-mono text-[0.75rem] text-muted-foreground">
											{config.urlScheme}:// · port {config.port}
										</p>
									</div>
								</div>
							</Reveal>
						);
					})}
				</ul>
			</div>
		</section>
	);
}

function Provision() {
	return (
		<section
			id="provision"
			aria-labelledby="provision-title"
			className="scroll-mt-20 border-border border-t bg-[linear-gradient(to_bottom,var(--card),transparent_60%)]"
		>
			<div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:py-28">
				<SectionHeading id="provision-title" title="Three ways in. Same API underneath.">
					The dashboard is one client of the same API your agent calls, so nothing here is
					dashboard-only.
				</SectionHeading>

				<Reveal className="mt-12">
					<Tabs defaultValue="mcp" className="gap-8">
						<TabsList variant="line" className="h-auto gap-6 border-border border-b pb-px">
							<TabsTrigger value="mcp" className="px-0 pb-3 text-[0.9375rem]">
								MCP server
							</TabsTrigger>
							<TabsTrigger value="api" className="px-0 pb-3 text-[0.9375rem]">
								REST API
							</TabsTrigger>
							<TabsTrigger value="dashboard" className="px-0 pb-3 text-[0.9375rem]">
								Dashboard
							</TabsTrigger>
						</TabsList>

						<TabsContent value="mcp">
							<ProvisionPanel
								title="Let your agent do it."
								body="blaze advertises OAuth, so Claude Code discovers it, registers itself and asks you to approve once in the browser. No key to copy, nothing to leak."
								points={[
									"Seven tools: create, list, connect, query, TTL, keys, delete",
									"Streamable HTTP, stateless",
									"Works in Claude Code, Claude Desktop, ChatGPT and Codex",
								]}
								extra={<PromptButton prompt={setupPrompt()} size="lg" />}
							>
								<CodeBlock
									label="Claude Code"
									code={`claude mcp add --transport http blaze ${MCP_URL}`}
								/>
								<CodeBlock
									label="~/.codex/config.toml"
									code={`[mcp_servers.blaze]\nurl = "${MCP_URL}"`}
								/>
							</ProvisionPanel>
						</TabsContent>

						<TabsContent value="api">
							<ProvisionPanel
								title="One POST, one connection string."
								body="Bearer-token auth, JSON in and out, stable error codes. Run SQL over HTTP without a driver; SQL errors come back as data, not as transport failures."
								points={[
									"ttl_seconds names its unit, so a guess errs long",
									"POST /v1/projects is idempotent by name",
									"Branch on error codes, never on messages",
								]}
							>
								<CodeBlock
									label="Create a database"
									code={`curl -X POST https://blaze.crafter.run/v1/databases \\
  -H "Authorization: Bearer $BLAZE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"my-app","ttl_seconds":86400}'`}
								/>
								<CodeBlock
									label="Run SQL, no driver"
									code={`curl -X POST https://blaze.crafter.run/v1/databases/$ID/query \\
  -H "Authorization: Bearer $BLAZE_KEY" \\
  -d '{"sql":"select now(), version()"}'`}
								/>
							</ProvisionPanel>
						</TabsContent>

						<TabsContent value="dashboard">
							<ProvisionPanel
								title="Or click a button."
								body="Pick an engine, optionally an expiry, and the connection string is ready to copy a moment later. Monitoring, a SQL editor and a table browser come with it."
								points={[
									"Passwords masked until you ask",
									"Rotate a password without dropping data",
									"Storage and connections charted from the engine itself",
								]}
							>
								<div className="rounded-xl border border-border bg-card p-5 shadow-xs">
									<div className="mb-4 flex items-center gap-3">
										<span className="flex size-8 items-center justify-center rounded-md border border-border bg-background">
											<EngineIcon engine="postgres" className="size-4" />
										</span>
										<div>
											<p className="font-medium text-sm">my-app</p>
											<p className="text-muted-foreground text-xs">PostgreSQL · ready</p>
										</div>
										<Badge variant="success" className="ml-auto">
											Active
										</Badge>
									</div>
									<ConnectionString
										value="postgresql://u_my_app_q647:example-password@pg.blaze.crafter.run:5433/db_my_app_x4k2?sslmode=require"
										masked="postgresql://u_my_app_q647:••••••••@pg.blaze.crafter.run:5433/db_my_app_x4k2?sslmode=require"
									/>
								</div>
							</ProvisionPanel>
						</TabsContent>
					</Tabs>
				</Reveal>
			</div>
		</section>
	);
}

function ProvisionPanel({
	title,
	body,
	points,
	extra,
	children,
}: {
	title: string;
	body: string;
	points: string[];
	extra?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
			<div>
				<h3 className="font-semibold text-2xl tracking-[-0.02em]">{title}</h3>
				<p className="mt-3 text-muted-foreground leading-relaxed">{body}</p>
				<ul className="mt-6 space-y-2.5 text-sm">
					{points.map((point) => (
						<li key={point} className="flex gap-2.5">
							<span className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-muted-foreground" />
							{point}
						</li>
					))}
				</ul>
				{extra && <div className="mt-8">{extra}</div>}
			</div>
			<div className="min-w-0 space-y-4">{children}</div>
		</div>
	);
}

function Limits() {
	const figures = [
		{ value: String(LIMITS.DATABASES_PER_USER), label: "databases per account" },
		{ value: formatBytes(LIMITS.STORAGE_BYTES).replace(".00", ""), label: "storage per database" },
		{ value: formatBytes(LIMITS.REDIS_MEMORY_BYTES).replace(".00", ""), label: "memory per Redis" },
		{ value: String(LIMITS.CONNECTION_LIMIT), label: "concurrent connections" },
		{ value: `${LIMITS.STATEMENT_TIMEOUT_MS / 1000}s`, label: "statement timeout" },
		{ value: `${LIMITS.IDLE_TRANSACTION_TIMEOUT_MS / 1000}s`, label: "idle in transaction" },
		{ value: `${TTL.MAX_MS / 86_400_000}d`, label: "longest TTL" },
		{ value: String(LIMITS.API_KEYS_PER_USER), label: "API keys" },
	];

	return (
		<section
			id="limits"
			aria-labelledby="limits-title"
			className="scroll-mt-20 border-border border-t"
		>
			<div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:py-28">
				<SectionHeading id="limits-title" title="The limits, up front.">
					blaze is free and has no billing, so these are what keep it running, not a tier to upgrade
					out of.
				</SectionHeading>

				<Reveal className="mt-12">
					<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
						{figures.map((figure) => (
							<div key={figure.label} className="bg-card px-5 py-6 sm:px-6 sm:py-7">
								<dd className="font-medium font-mono text-3xl tabular-nums tracking-[-0.04em] sm:text-4xl">
									{figure.value}
								</dd>
								<dt className="mt-2 text-muted-foreground text-sm">{figure.label}</dt>
							</div>
						))}
					</dl>
				</Reveal>

				<div className="mt-10 grid gap-6 text-sm leading-relaxed md:grid-cols-3">
					<Reveal>
						<p className="font-medium">Over quota means paused, not deleted.</p>
						<p className="mt-1.5 text-muted-foreground">
							Storage is sampled every {METRICS_INTERVAL_MS / 60_000} minutes. A database over its
							limit refuses connections until it is back under, then comes back on its own.
						</p>
					</Reveal>
					<Reveal delay={0.05}>
						<p className="font-medium">No backups yet.</p>
						<p className="mt-1.5 text-muted-foreground">
							Treat alpha databases as somewhere to build and test. A dropped database is gone, and
							there is nothing to restore it from.
						</p>
					</Reveal>
					<Reveal delay={0.1}>
						<p className="font-medium">One region, one machine.</p>
						<p className="mt-1.5 text-muted-foreground">
							blaze runs on a single VPS today. Connection strings use hostnames, never IPs, so it
							can grow without breaking the strings you have saved.
						</p>
					</Reveal>
				</div>
			</div>
		</section>
	);
}

function Security() {
	const facts = [
		{
			icon: Lock,
			title: "TLS on every connection",
			body: "The server refuses unencrypted connections. The certificate is self-signed for now: traffic is encrypted, the server is not yet authenticated.",
		},
		{
			icon: Split,
			title: "One role per database",
			body: "Each database gets a role that owns it and reaches nothing else on the instance, including other tenants and the maintenance database.",
		},
		{
			icon: ServerCog,
			title: "Redis gets its own container",
			body: "Redis ACLs cannot contain a tenant: FLUSHALL ignores key patterns. So every Redis is a separate container with its own memory cap.",
		},
		{
			icon: KeyRound,
			title: "Secrets stored the right way",
			body: "Database passwords are encrypted with AES-GCM so the dashboard can show them. API keys are stored only as SHA-256 hashes.",
		},
		{
			icon: Fingerprint,
			title: "OAuth for agents",
			body: "The MCP server advertises OAuth, so an agent gets its own token after you approve it, instead of a long-lived key pasted into a config.",
		},
		{
			icon: Globe,
			title: "Hostnames, never IPs",
			body: "Every database is addressed through DNS blaze controls, so moving a container is a config change, not a broken connection string.",
		},
	];

	return (
		<section
			id="security"
			aria-labelledby="security-title"
			className="scroll-mt-20 border-border border-t"
		>
			<div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:py-28">
				<div className="lg:sticky lg:top-28 lg:self-start">
					<SectionHeading id="security-title" title="Isolation you can read about.">
						How tenants are kept apart, and the one thing that is not finished yet.
					</SectionHeading>
					<Reveal delay={0.1}>
						<div className="mt-8 rounded-xl border border-warning/25 bg-warning/[0.07] p-4 text-sm leading-relaxed">
							<p className="flex items-center gap-2 font-medium text-warning">
								<ShieldCheck className="size-4" />
								Using node-postgres?
							</p>
							<p className="mt-1.5 text-muted-foreground">
								Version 8.23 and later treats{" "}
								<code className="text-foreground">sslmode=require</code> as verify-full and rejects
								the self-signed certificate. Use{" "}
								<code className="text-foreground">sslmode=no-verify</code> until a publicly trusted
								certificate is in place.
							</p>
						</div>
					</Reveal>
				</div>

				<ul className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
					{facts.map((fact, index) => (
						<Reveal as="li" key={fact.title} delay={(index % 2) * 0.05} className="bg-card p-6">
							<fact.icon className="size-5 text-muted-foreground" strokeWidth={1.5} />
							<p className="mt-4 font-medium">{fact.title}</p>
							<p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{fact.body}</p>
						</Reveal>
					))}
				</ul>
			</div>
		</section>
	);
}

function WaitlistCta() {
	return (
		<section aria-labelledby="waitlist-title" className="border-border border-t">
			<div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:py-28">
				<Reveal>
					<div className="relative isolate overflow-hidden rounded-3xl border border-border bg-card px-6 py-16 text-center shadow-xs sm:px-12 sm:py-20">
						<div
							aria-hidden="true"
							className="absolute inset-0 -z-10 bg-[radial-gradient(45%_60%_at_50%_0%,var(--brand-soft),transparent)]"
						/>
						<div
							aria-hidden="true"
							className="absolute inset-0 -z-10 [background-image:radial-gradient(var(--border-strong)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(60%_70%_at_50%_0%,black,transparent)]"
						/>
						<Isotype className="mx-auto h-14" animated />
						<h2
							id="waitlist-title"
							className="mx-auto mt-8 max-w-xl font-semibold text-3xl tracking-[-0.03em] sm:text-4xl"
						>
							blaze is in private alpha.
						</h2>
						<p className="mx-auto mt-4 max-w-md text-muted-foreground leading-relaxed">
							We are letting people in a few at a time while the edges get filed down. Leave your
							email and you will get an invite.
						</p>
						<div className="mt-9 flex flex-wrap items-center justify-center gap-3">
							<Button size="xl" asChild>
								<Link href="/waitlist">
									Join the waitlist
									<ArrowRight data-icon="inline-end" />
								</Link>
							</Button>
							<Button size="xl" variant="ghost" asChild>
								<Link href="/sign-in">I have an invite</Link>
							</Button>
						</div>
					</div>
				</Reveal>
			</div>
		</section>
	);
}

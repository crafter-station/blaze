import { ArrowLeft, Terminal } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { ENGINE_CONFIG, ENGINES } from "@/lib/engines/types";
import { LIMITS, TTL } from "@/lib/limits";
import { MCP_URL, setupPrompt } from "@/lib/setup-prompt";

export const metadata = {
	title: "Docs",
	description: "Provision and query managed Postgres from a REST API or an MCP server.",
};

const SECTIONS = [
	["quickstart", "Quickstart"],
	["mcp", "MCP server"],
	["auth", "Authentication"],
	["databases", "Databases"],
	["query", "Running SQL"],
	["projects", "Projects"],
	["errors", "Errors"],
	["limits", "Limits"],
	["tls", "TLS"],
] as const;

export default function DocsPage() {
	return (
		<div className="min-h-screen">
			<header className="sticky top-0 z-20 border-border border-b bg-background/85 backdrop-blur">
				<div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
					<Link
						href="/"
						className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
					>
						<ArrowLeft className="size-3.5" />
						blaze
					</Link>
					<Link
						href="/api-keys"
						className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
					>
						Get an API key
					</Link>
				</div>
			</header>

			<div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 lg:grid-cols-[180px_minmax(0,1fr)]">
				<nav className="hidden lg:block">
					<div className="sticky top-24 space-y-1">
						{SECTIONS.map(([id, label]) => (
							<a
								key={id}
								href={`#${id}`}
								className="block rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground"
							>
								{label}
							</a>
						))}
					</div>
				</nav>

				<main className="min-w-0 space-y-14">
					<div>
						<h1 className="font-semibold text-[34px] leading-tight tracking-tight">Docs</h1>
						<p className="mt-3 max-w-2xl text-muted-foreground">
							blaze provisions managed Postgres in about 200&nbsp;milliseconds and lets you run SQL
							against it without a driver. Everything below works from an API key — the dashboard is
							one client of the same API.
						</p>
					</div>

					<Section id="quickstart" title="Quickstart">
						<p>
							Create a key on the{" "}
							<Link href="/api-keys" className="text-foreground underline">
								API keys
							</Link>{" "}
							page, then:
						</p>
						<Code
							label="Create a database"
							code={`curl -X POST https://blaze.crafter.run/v1/databases \\
  -H "Authorization: Bearer $BLAZE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"my-app","ttl_seconds":86400}'`}
						/>
						<Code
							label="Response"
							code={`{
  "id": "db_c28u7dyz23fc",
  "name": "my-app",
  "engine": "postgres",
  "status": "active",
  "host": "pg.blaze.crafter.run",
  "port": 5433,
  "connection_string": "postgresql://u_my_app_q647:...@pg.blaze.crafter.run:5433/db_my_app_x4k2?sslmode=require",
  "expires_at": "2026-08-20T20:28:12.171Z",
  "took_ms": 286
}`}
						/>
					</Section>

					<Section id="mcp" title="MCP server">
						<p>
							The fastest way in, and it needs no API key at all. blaze advertises OAuth, so Claude
							Code discovers the authorization server, registers itself, and opens a browser for you
							to approve once. Paste this and it will configure blaze, verify the connection, and
							leave you with a working database.
						</p>
						<PromptBlock />
						<p className="text-muted-foreground text-sm">
							Endpoint <Mono>{MCP_URL}</Mono>, Streamable HTTP transport. Authenticate with OAuth,
							or with the same bearer key as the REST API where no browser is available. Seven
							tools:
						</p>
						<Table
							head={["Tool", "What it does"]}
							rows={[
								["create_database", "Provision a database, returns a connection string"],
								["list_databases", "Everything this key owns, with size and expiry"],
								["get_connection_string", "Credentials for one database"],
								["run_query", "Execute SQL and get rows back — no driver needed"],
								["set_ttl", "Change or clear auto-delete"],
								["create_api_key", "Mint a key for your own app or CI"],
								["delete_database", "Permanent, no undo"],
							]}
						/>
					</Section>

					<Section id="auth" title="Authentication">
						<p>
							Every request carries a bearer token. Keys are shown once at creation and stored only
							as a hash — a lost key is replaced, not recovered.
						</p>
						<Code code={`Authorization: Bearer blz_live_...`} />
						<p className="text-muted-foreground text-sm">
							A key acts as its owner and reaches every database that account owns. Missing,
							malformed, unknown and revoked keys all return the same <Mono>401</Mono> —
							distinguishing them would let someone probe which keys exist.
						</p>
					</Section>

					<Section id="databases" title="Databases">
						<Table
							head={["Method", "Path", "Notes"]}
							rows={[
								["GET", "/v1/databases", "List. No credentials included."],
								["POST", "/v1/databases", "Create. Returns the connection string."],
								["GET", "/v1/databases/:id", "Read one, with credentials."],
								["PATCH", "/v1/databases/:id", "Rename, or set/clear ttl_seconds."],
								["DELETE", "/v1/databases/:id", "Permanent."],
							]}
						/>
						<p className="text-muted-foreground text-sm">
							<Mono>ttl_seconds</Mono> names its unit deliberately — guessing wrong should give you
							a database that lives 24 hours rather than 24 seconds. Send <Mono>null</Mono> to clear
							an expiry; omit the field to leave it untouched.
						</p>
					</Section>

					<Section id="query" title="Running SQL">
						<Code
							label="POST /v1/databases/:id/query"
							code={`curl -X POST https://blaze.crafter.run/v1/databases/$ID/query \\
  -H "Authorization: Bearer $BLAZE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"sql":"select now(), version()"}'`}
						/>
						<p>
							Queries run as that database&apos;s own role, so they reach nothing else on the
							instance. Statements time out after {LIMITS.STATEMENT_TIMEOUT_MS / 1000}s and at most
							500 rows come back.
						</p>
						<Callout>
							A SQL error returns <Mono>200</Mono> with <Mono>{`"ok": false`}</Mono>, not a 4xx. The
							HTTP call succeeded; the SQL did not. Collapsing the two would make clients retry
							transport failures and syntax errors identically — read <Mono>ok</Mono> before
							trusting <Mono>rows</Mono>.
						</Callout>
					</Section>

					<Section id="projects" title="Projects">
						<p>
							Databases live in projects, and a <Mono>default</Mono> project is created for you on
							first use — you never have to think about them. <Mono>POST /v1/projects</Mono> is
							idempotent by name, so an agent that cannot remember whether it already created one
							can call it again safely.
						</p>
					</Section>

					<Section id="errors" title="Errors">
						<Code
							code={`{ "error": { "code": "quota_exceeded", "message": "Limit of 5 databases reached..." } }`}
						/>
						<p className="text-muted-foreground text-sm">
							Branch on <Mono>code</Mono>, never on the message. Codes are stable; wording is not.
						</p>
						<Table
							head={["Code", "Status"]}
							rows={[
								["unauthorized", "401"],
								["invalid_request", "400"],
								["unsupported_engine", "400"],
								["quota_exceeded", "402"],
								["not_found", "404"],
								["database_suspended", "409"],
								["internal", "500"],
							]}
						/>
					</Section>

					<Section id="limits" title="Limits">
						<Table
							head={["Limit", "Value"]}
							rows={[
								["Databases per account", String(LIMITS.DATABASES_PER_USER)],
								["Storage per database", `${LIMITS.STORAGE_BYTES / 1024 / 1024} MB`],
								["Concurrent connections", `${LIMITS.CONNECTION_LIMIT} per database`],
								["Statement timeout", `${LIMITS.STATEMENT_TIMEOUT_MS / 1000}s`],
								["Longest TTL", `${TTL.MAX_MS / 86_400_000} days`],
								["API keys", String(LIMITS.API_KEYS_PER_USER)],
							]}
						/>
						<p className="text-muted-foreground text-sm">
							blaze is free and has no billing, so these limits are what keeps it running rather
							than a tier to upgrade out of. Storage is sampled every five minutes; a database over
							its limit is suspended — connections refused, nothing deleted — and reinstated
							automatically once it is back under.
						</p>
						<p className="text-muted-foreground text-sm">
							Engines: {ENGINES.map((e) => ENGINE_CONFIG[e].label).join(", ")}. Only PostgreSQL is
							available today; the rest are modelled but not yet provisioned.
						</p>
					</Section>

					<Section id="tls" title="TLS">
						<p>
							The server refuses unencrypted connections. The certificate is currently self-signed,
							which means traffic is encrypted but the server is not authenticated.
						</p>
						<Callout>
							Most clients work with <Mono>?sslmode=require</Mono> — libpq, psql, psycopg, pgx,
							Prisma, postgres.js — because <Mono>require</Mono> means &quot;encrypt, do not
							verify&quot;. <strong>node-postgres 8.23+</strong> currently treats it as{" "}
							<Mono>verify-full</Mono> and will reject the certificate; use{" "}
							<Mono>?sslmode=no-verify</Mono> there until a publicly trusted certificate is in
							place.
						</Callout>
					</Section>
				</main>
			</div>
		</div>
	);
}

function Section({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section id={id} className="scroll-mt-24 space-y-4">
			<h2 className="font-semibold text-xl tracking-tight">{title}</h2>
			<div className="space-y-4 text-[15px] leading-relaxed">{children}</div>
		</section>
	);
}

function Code({ code, label }: { code: string; label?: string }) {
	return (
		<div className="overflow-hidden rounded-xl border border-border bg-card">
			<div className="flex items-center justify-between gap-3 border-border border-b px-4 py-2">
				<span className="text-muted-foreground text-xs">{label ?? "Example"}</span>
				<CopyButton value={code} />
			</div>
			<pre className="overflow-x-auto px-4 py-3 text-[13px] leading-relaxed">{code}</pre>
		</div>
	);
}

function PromptBlock() {
	const prompt = setupPrompt();
	return (
		<div className="overflow-hidden rounded-xl border border-border bg-card">
			<div className="flex items-center justify-between gap-3 border-border border-b px-4 py-2.5">
				<span className="inline-flex items-center gap-2 text-muted-foreground text-xs">
					<Terminal className="size-3.5" />
					Paste into Claude Code
				</span>
				<CopyButton value={prompt} label="Copy prompt" />
			</div>
			<pre className="overflow-x-auto whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed">
				{prompt}
			</pre>
		</div>
	);
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
	return (
		<div className="overflow-x-auto rounded-xl border border-border bg-card">
			<table className="w-full text-left text-sm">
				<thead>
					<tr className="border-border border-b text-muted-foreground text-xs">
						{head.map((cell) => (
							<th key={cell} className="px-4 py-2.5 font-medium">
								{cell}
							</th>
						))}
					</tr>
				</thead>
				<tbody className="divide-y divide-border">
					{rows.map((row) => (
						<tr key={row.join("|")}>
							{row.map((cell, index) => (
								<td
									key={cell}
									className={
										index === 0
											? "px-4 py-2.5 font-mono text-[13px]"
											: "px-4 py-2.5 text-muted-foreground"
									}
								>
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function Callout({ children }: { children: React.ReactNode }) {
	return (
		<div className="rounded-xl border border-warning/25 bg-warning/5 px-5 py-4 text-[14px] text-muted-foreground leading-relaxed">
			{children}
		</div>
	);
}

function Mono({ children }: { children: React.ReactNode }) {
	return (
		<code className="rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground">{children}</code>
	);
}

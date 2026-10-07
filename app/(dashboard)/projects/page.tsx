import { and, desc, eq, isNull } from "drizzle-orm";
import { ArrowUpRight, Bot, Braces, Database, SquareTerminal } from "lucide-react";
import Link from "next/link";
import { EngineTile } from "@/components/brand/engine-icon";
import { ConnectionString } from "@/components/connection-string";
import { EmptyState, Meter, PageHeader, Panel, Stat } from "@/components/console/page";
import { CreateDatabase, DeleteDatabase } from "@/components/create-database";
import { StatusPill } from "@/components/dashboard/status-pill";
import { requireUser } from "@/lib/auth";
import { buildConnectionString } from "@/lib/connection";
import { db } from "@/lib/control/db";
import { databases } from "@/lib/control/schema";
import { PROVISIONABLE } from "@/lib/engines/available";
import { ENGINE_CONFIG, ENGINES } from "@/lib/engines/types";
import { formatBytes, formatExpiry, percentOf } from "@/lib/format";
import { LIMITS } from "@/lib/limits";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
	const user = await requireUser();

	const rows = await db.query.databases.findMany({
		where: and(eq(databases.ownerUserId, user.id), isNull(databases.deletedAt)),
		with: { project: true },
		orderBy: [desc(databases.createdAt)],
	});

	const totalBytes = rows.reduce((sum, r) => sum + r.sizeBytes, 0);
	const atQuota = rows.length >= LIMITS.DATABASES_PER_USER;

	return (
		<div className="space-y-8">
			<PageHeader
				title="Overview"
				description="Free while in alpha. No card, and no expiry on the plan."
				actions={<CreateDatabase atQuota={atQuota} />}
			/>

			<Panel
				footer={
					<>
						Storage is sampled every 5 minutes. Postgres has no per-database disk quota, so the
						sampler is what enforces the limit, and a database can briefly exceed it between
						samples.
					</>
				}
			>
				<div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4 [&>*]:bg-card [&>*]:px-4 [&>*]:py-4 sm:[&>*]:px-5 sm:[&>*]:py-5">
					<Stat
						label="Databases"
						value={String(rows.length)}
						limit={`/ ${LIMITS.DATABASES_PER_USER}`}
					>
						<Meter className="mt-3" percent={percentOf(rows.length, LIMITS.DATABASES_PER_USER)} />
					</Stat>
					<Stat
						label="Storage used"
						value={formatBytes(totalBytes)}
						limit={`/ ${formatBytes(LIMITS.STORAGE_BYTES)} each`}
					/>
					<Stat label="Connections" value={String(LIMITS.CONNECTION_LIMIT)} limit="per database" />
					<Stat
						label="Engines"
						value={String(PROVISIONABLE.length)}
						limit={`of ${ENGINES.length} available`}
					/>
				</div>
			</Panel>

			{rows.length > 0 && <GetConnected />}

			<Panel
				title={
					<>
						Databases
						<span className="ml-2 font-normal text-muted-foreground tabular-nums">
							{rows.length}
						</span>
					</>
				}
				icon={Database}
				action={
					rows.length > 0 ? (
						<Link
							href="/databases"
							className="inline-flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
						>
							View all
							<ArrowUpRight className="size-3.5" />
						</Link>
					) : undefined
				}
			>
				{rows.length === 0 ? (
					<EmptyState
						icon={Database}
						title="No databases yet"
						description="Create one and you get a connection string in about 200 milliseconds."
						action={<CreateDatabase atQuota={atQuota} />}
					/>
				) : (
					<ul className="divide-y divide-border">
						{rows.map((row) => {
							const expiry = formatExpiry(row.expiresAt);
							const target = {
								engine: row.engine,
								id: row.id,
								slug: row.slug,
								dbName: row.dbName,
								roleName: row.roleName,
								passwordEnc: row.passwordEnc,
							};
							return (
								<li key={row.id} className="px-5 py-5">
									<div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
										<div className="flex min-w-0 items-center gap-3">
											<EngineTile engine={row.engine} />
											<div className="min-w-0">
												<div className="flex flex-wrap items-center gap-2">
													<Link
														href={`/databases/${row.id}`}
														className="truncate font-medium hover:underline hover:underline-offset-4"
													>
														{row.name}
													</Link>
													<StatusPill status={row.status} />
													{expiry && (
														<span className="text-muted-foreground text-xs">
															{expiry === "expired" ? "TTL expired" : `Deletes ${expiry}`}
														</span>
													)}
												</div>
												<p className="mt-0.5 truncate text-muted-foreground text-xs">
													{ENGINE_CONFIG[row.engine].label} · owner{" "}
													<span className="font-mono">{row.roleName}</span>
												</p>
											</div>
										</div>
										<div className="flex items-center gap-3 text-muted-foreground text-xs">
											<span className="font-mono tabular-nums">{formatBytes(row.sizeBytes)}</span>
											<DeleteDatabase id={row.id} name={row.name} />
										</div>
									</div>
									<ConnectionString
										label=""
										value={buildConnectionString(target, true)}
										masked={buildConnectionString(target, false)}
									/>
								</li>
							);
						})}
					</ul>
				)}
			</Panel>
		</div>
	);
}

/** Mirrors Neon's "Get connected" card: the onboarding surface, not decoration. */
function GetConnected() {
	const tiles = [
		{
			icon: SquareTerminal,
			title: "Connection string",
			body: "Copy a string below into your app config, or open it with psql.",
			href: undefined,
		},
		{
			icon: Braces,
			title: "REST API",
			body: "Provision and query from a script or CI with an API key.",
			href: "/docs/databases",
		},
		{
			icon: Bot,
			title: "MCP server",
			body: "Let an agent create and query databases in conversation.",
			href: "/docs/mcp",
		},
	];

	return (
		<section aria-labelledby="get-connected" className="space-y-3">
			<h2 id="get-connected" className="font-medium text-[0.9375rem] tracking-[-0.01em]">
				Get connected
			</h2>
			<div className="grid gap-3 md:grid-cols-3">
				{tiles.map((tile) => {
					const content = (
						<>
							<div className="mb-2 flex items-center gap-2.5">
								<tile.icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
								<p className="font-medium text-sm">{tile.title}</p>
								{tile.href && (
									<ArrowUpRight className="ml-auto size-3.5 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
								)}
							</div>
							<p className="text-muted-foreground text-xs leading-relaxed">{tile.body}</p>
						</>
					);
					const className =
						"group block rounded-xl border border-border bg-card p-4 shadow-xs transition-colors";
					return tile.href ? (
						<Link
							key={tile.title}
							href={tile.href}
							className={`${className} hover:border-border-strong hover:bg-accent/40`}
						>
							{content}
						</Link>
					) : (
						<div key={tile.title} className={className}>
							{content}
						</div>
					);
				})}
			</div>
		</section>
	);
}

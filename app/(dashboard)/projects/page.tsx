import { and, desc, eq, isNull } from "drizzle-orm";
import { Braces, Database, Link2, SquareTerminal } from "lucide-react";
import { ConnectionString } from "@/components/connection-string";
import { CreateDatabase, DeleteDatabase } from "@/components/create-database";
import { requireUser } from "@/lib/auth";
import { buildConnectionString } from "@/lib/connection";
import { db } from "@/lib/control/db";
import { databases } from "@/lib/control/schema";
import { ENGINE_CONFIG } from "@/lib/engines/types";
import { formatBytes, formatExpiry } from "@/lib/format";
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
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="font-semibold text-[42px] leading-tight tracking-tight">Overview</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						Free while in alpha — no card, no expiry on the plan.
					</p>
				</div>
				<CreateDatabase atQuota={atQuota} />
			</div>

			{rows.length > 0 && <GetConnected />}

			<section className="rounded-xl border border-border bg-card p-7">
				<div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
					<Stat
						label="Databases"
						value={String(rows.length)}
						limit={String(LIMITS.DATABASES_PER_USER)}
					/>
					<Stat
						label="Storage"
						value={formatBytes(totalBytes)}
						limit={`${formatBytes(LIMITS.STORAGE_BYTES)} each`}
					/>
					<Stat label="Connections" value={String(LIMITS.CONNECTION_LIMIT)} limit="per database" />
					<Stat label="Engines" value="1" limit="of 6 available" />
				</div>
				<hr className="my-6 border-border" />
				<p className="text-muted-foreground text-xs">
					Storage is sampled every 5 minutes. Postgres has no per-database disk quota, so the
					sampler is what enforces the limit — a database can briefly exceed it between samples.
				</p>
			</section>

			<section className="rounded-xl border border-border bg-card">
				<div className="flex items-center justify-between border-border border-b px-7 py-5">
					<div className="flex items-center gap-3">
						<Database className="size-[18px] text-muted-foreground" />
						<h2 className="font-medium">
							{rows.length} {rows.length === 1 ? "database" : "databases"}
						</h2>
					</div>
				</div>

				{rows.length === 0 ? (
					<div className="px-7 py-16 text-center">
						<p className="font-medium">No databases yet</p>
						<p className="mx-auto mt-1.5 max-w-md text-muted-foreground text-sm">
							Create one and you get a Postgres connection string in about 200&nbsp;milliseconds.
						</p>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{rows.map((row) => {
							const expiry = formatExpiry(row.expiresAt);
							const target = {
								engine: row.engine,
								slug: row.slug,
								dbName: row.dbName,
								roleName: row.roleName,
								passwordEnc: row.passwordEnc,
							};
							return (
								<li key={row.id} className="px-7 py-6">
									<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
										<div className="flex items-center gap-3">
											<span className="flex size-9 items-center justify-center rounded-lg border border-border bg-background">
												<Database className="size-4 text-muted-foreground" />
											</span>
											<div>
												<p className="font-medium">{row.name}</p>
												<p className="text-muted-foreground text-xs">
													{ENGINE_CONFIG[row.engine].label} · owner {row.roleName}
												</p>
											</div>
											{row.status === "active" ? (
												<span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] text-success">
													<span className="size-1.5 rounded-full bg-success" />
													Active
												</span>
											) : (
												<span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] text-warning">
													{row.status}
												</span>
											)}
											{expiry && <span className="text-muted-foreground text-xs">{expiry}</span>}
										</div>
										<div className="flex items-center gap-4 text-muted-foreground text-xs">
											<span>{formatBytes(row.sizeBytes)}</span>
											<DeleteDatabase id={row.id} name={row.name} />
										</div>
									</div>
									<ConnectionString
										value={buildConnectionString(target, true)}
										masked={buildConnectionString(target, false)}
									/>
								</li>
							);
						})}
					</ul>
				)}
			</section>
		</div>
	);
}

function Stat({ label, value, limit }: { label: string; value: string; limit: string }) {
	return (
		<div>
			<p className="text-muted-foreground text-sm">{label}</p>
			<p className="mt-2 font-semibold text-3xl tracking-tight">
				{value}
				<span className="ml-1.5 font-normal text-base text-muted-foreground">/ {limit}</span>
			</p>
		</div>
	);
}

/** Mirrors Neon's "Get connected" card — the onboarding surface, not decoration. */
function GetConnected() {
	const tiles = [
		{
			icon: Link2,
			title: "Connection string",
			body: "Copy the string below and drop it into your app config.",
			ready: true,
		},
		{
			icon: SquareTerminal,
			title: "psql",
			body: "Connect from your terminal with the same credentials.",
			ready: true,
		},
		{
			icon: Braces,
			title: "REST API",
			body: "Provision databases with an API key instead of this dashboard.",
			ready: false,
		},
		{
			icon: Database,
			title: "MCP server",
			body: "Let an agent create and query databases in-conversation.",
			ready: false,
		},
	];

	return (
		<section className="rounded-xl border border-border bg-card p-7">
			<h2 className="mb-5 font-medium">Get connected</h2>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{tiles.map((tile) => (
					<div key={tile.title} className="rounded-lg border border-border bg-background p-5">
						<div className="mb-3 flex items-center gap-2.5">
							<tile.icon className="size-[18px] text-primary" />
							<p className="font-medium text-sm">{tile.title}</p>
							{!tile.ready && (
								<span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
									soon
								</span>
							)}
						</div>
						<p className="text-muted-foreground text-xs leading-relaxed">{tile.body}</p>
					</div>
				))}
			</div>
		</section>
	);
}

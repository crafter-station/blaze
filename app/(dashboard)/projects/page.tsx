import { and, desc, eq, isNull } from "drizzle-orm";
import { ConnectionString } from "@/components/connection-string";
import { CreateDatabase, DeleteDatabase } from "@/components/create-database";
import { requireUser } from "@/lib/auth";
import { buildConnectionString } from "@/lib/connection";
import { db } from "@/lib/control/db";
import { databases } from "@/lib/control/schema";
import { ENGINE_CONFIG } from "@/lib/engines/types";
import { LIMITS } from "@/lib/limits";

export const metadata = { title: "Databases" };
export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatExpiry(expiresAt: Date | null): string | null {
	if (!expiresAt) return null;
	const ms = expiresAt.getTime() - Date.now();
	if (ms <= 0) return "expired";
	const hours = Math.round(ms / 3_600_000);
	return hours < 48 ? `expires in ${hours}h` : `expires in ${Math.round(hours / 24)}d`;
}

export default async function ProjectsPage() {
	const user = await requireUser();

	const rows = await db.query.databases.findMany({
		where: and(eq(databases.ownerUserId, user.id), isNull(databases.deletedAt)),
		with: { project: true },
		orderBy: [desc(databases.createdAt)],
	});

	const atQuota = rows.length >= LIMITS.DATABASES_PER_USER;

	return (
		<div className="space-y-8">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="font-semibold text-2xl tracking-tight">Databases</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						{rows.length} of {LIMITS.DATABASES_PER_USER} used · {formatBytes(LIMITS.STORAGE_BYTES)}{" "}
						each · free while in alpha
					</p>
				</div>
				<CreateDatabase atQuota={atQuota} />
			</div>

			{rows.length === 0 ? (
				<div className="rounded-lg border border-border border-dashed p-12 text-center">
					<p className="font-medium">No databases yet</p>
					<p className="mx-auto mt-1 max-w-md text-muted-foreground text-sm">
						Create one and you get a Postgres connection string in about 200&nbsp;milliseconds.
					</p>
				</div>
			) : (
				<ul className="space-y-3">
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
							<li key={row.id} className="rounded-lg border border-border bg-card p-4">
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div className="flex items-center gap-3">
										<span className="font-medium">{row.name}</span>
										<span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground text-xs">
											{ENGINE_CONFIG[row.engine].label}
										</span>
										{row.status !== "active" && (
											<span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning text-xs">
												{row.status}
											</span>
										)}
										{expiry && <span className="text-muted-foreground text-xs">{expiry}</span>}
									</div>
									<div className="flex items-center gap-4 text-muted-foreground text-xs">
										<span>{formatBytes(row.sizeBytes)}</span>
										<span>{row.project.name}</span>
										<DeleteDatabase id={row.id} name={row.name} />
									</div>
								</div>
								<div className="mt-3">
									<ConnectionString
										value={buildConnectionString(target, true)}
										masked={buildConnectionString(target, false)}
									/>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

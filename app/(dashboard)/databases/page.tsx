import { and, desc, eq, isNull } from "drizzle-orm";
import { ChevronRight, Database } from "lucide-react";
import Link from "next/link";
import { CreateDatabase } from "@/components/create-database";
import { StatusPill } from "@/components/dashboard/status-pill";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/control/db";
import { databases } from "@/lib/control/schema";
import { ENGINE_CONFIG } from "@/lib/engines/types";
import { formatBytes, formatDate, formatExpiry } from "@/lib/format";
import { LIMITS } from "@/lib/limits";

export const metadata = { title: "Databases" };
export const dynamic = "force-dynamic";

export default async function DatabasesPage() {
	const user = await requireUser();

	const rows = await db.query.databases.findMany({
		where: and(eq(databases.ownerUserId, user.id), isNull(databases.deletedAt)),
		with: { project: true },
		orderBy: [desc(databases.createdAt)],
	});

	return (
		<div className="space-y-8">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="font-semibold text-[42px] leading-tight tracking-tight">Databases</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						{rows.length} of {LIMITS.DATABASES_PER_USER} used
					</p>
				</div>
				<CreateDatabase atQuota={rows.length >= LIMITS.DATABASES_PER_USER} />
			</div>

			<section className="overflow-hidden rounded-xl border border-border bg-card">
				{rows.length === 0 ? (
					<div className="px-7 py-20 text-center">
						<Database className="mx-auto mb-4 size-8 text-muted-foreground/50" />
						<p className="font-medium">No databases yet</p>
						<p className="mx-auto mt-1.5 max-w-md text-muted-foreground text-sm">
							Create one and you get a Postgres connection string in about 200&nbsp;milliseconds.
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[760px] text-sm">
							<thead>
								<tr className="border-border border-b text-left text-muted-foreground text-xs">
									<th className="px-7 py-3.5 font-medium">Name</th>
									<th className="px-4 py-3.5 font-medium">Engine</th>
									<th className="px-4 py-3.5 font-medium">Status</th>
									<th className="px-4 py-3.5 font-medium">Size</th>
									<th className="px-4 py-3.5 font-medium">Created</th>
									<th className="px-4 py-3.5 font-medium">Expires</th>
									<th className="px-7 py-3.5" />
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{rows.map((row) => (
									<tr key={row.id} className="group transition-colors hover:bg-accent/40">
										<td className="px-7 py-4">
											<Link href={`/databases/${row.id}`} className="flex items-center gap-3">
												<span className="flex size-8 items-center justify-center rounded-lg border border-border bg-background">
													<Database className="size-3.5 text-muted-foreground" />
												</span>
												<span>
													<span className="block font-medium">{row.name}</span>
													<span className="block text-muted-foreground text-xs">
														{row.project.name}
													</span>
												</span>
											</Link>
										</td>
										<td className="px-4 py-4 text-muted-foreground">
											{ENGINE_CONFIG[row.engine].label}
										</td>
										<td className="px-4 py-4">
											<StatusPill status={row.status} />
										</td>
										<td className="px-4 py-4 text-muted-foreground tabular-nums">
											{formatBytes(row.sizeBytes)}
										</td>
										<td className="px-4 py-4 text-muted-foreground">{formatDate(row.createdAt)}</td>
										<td className="px-4 py-4 text-muted-foreground">
											{formatExpiry(row.expiresAt) ?? "—"}
										</td>
										<td className="px-7 py-4 text-right">
											<Link
												href={`/databases/${row.id}`}
												className="inline-flex items-center gap-1 text-muted-foreground text-xs transition-colors group-hover:text-foreground"
											>
												Open
												<ChevronRight className="size-3.5" />
											</Link>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}

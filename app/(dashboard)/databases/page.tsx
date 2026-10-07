import { and, desc, eq, isNull } from "drizzle-orm";
import { ChevronRight, Database } from "lucide-react";
import Link from "next/link";
import { EngineTile } from "@/components/brand/engine-icon";
import { EmptyState, PageHeader, Panel } from "@/components/console/page";
import { CreateDatabase } from "@/components/create-database";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
	const atQuota = rows.length >= LIMITS.DATABASES_PER_USER;

	return (
		<div className="space-y-8">
			<PageHeader
				title="Databases"
				description={
					<span className="tabular-nums">
						{rows.length} of {LIMITS.DATABASES_PER_USER} used
					</span>
				}
				actions={<CreateDatabase atQuota={atQuota} />}
			/>

			<Panel>
				{rows.length === 0 ? (
					<EmptyState
						icon={Database}
						title="No databases yet"
						description="Create one and you get a connection string in about 200 milliseconds."
						action={<CreateDatabase atQuota={atQuota} />}
					/>
				) : (
					<Table className="md:min-w-[760px]">
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead>Name</TableHead>
								<TableHead className="hidden md:table-cell">Engine</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="hidden text-right md:table-cell">Size</TableHead>
								<TableHead className="hidden lg:table-cell">Created</TableHead>
								<TableHead className="hidden lg:table-cell">Expires</TableHead>
								<TableHead>
									<span className="sr-only">Open</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.id} className="group relative">
									<TableCell>
										<Link
											href={`/databases/${row.id}`}
											className="flex items-center gap-3 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
										>
											<EngineTile engine={row.engine} size="sm" />
											<span className="min-w-0">
												<span className="block truncate font-medium">{row.name}</span>
												<span className="block truncate text-muted-foreground text-xs">
													{row.project.name}
												</span>
											</span>
										</Link>
									</TableCell>
									<TableCell className="hidden text-muted-foreground md:table-cell">
										{ENGINE_CONFIG[row.engine].label}
									</TableCell>
									<TableCell>
										<StatusPill status={row.status} />
									</TableCell>
									<TableCell className="hidden text-right font-mono md:table-cell text-[0.8125rem] text-muted-foreground tabular-nums">
										{formatBytes(row.sizeBytes)}
									</TableCell>
									<TableCell className="hidden text-muted-foreground lg:table-cell">
										{formatDate(row.createdAt)}
									</TableCell>
									<TableCell className="hidden text-muted-foreground lg:table-cell">
										{formatExpiry(row.expiresAt) ?? (
											<span className="text-muted-foreground/50">Never</span>
										)}
									</TableCell>
									<TableCell className="w-10 text-right">
										<ChevronRight className="ml-auto size-4 text-muted-foreground/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</Panel>
		</div>
	);
}

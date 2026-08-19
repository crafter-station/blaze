import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SqlEditor } from "@/components/dashboard/sql-editor";
import { StatusPill } from "@/components/dashboard/status-pill";
import { requireUser } from "@/lib/auth";
import { ENGINE_CONFIG } from "@/lib/engines/types";
import { LIMITS } from "@/lib/limits";
import { getOwnedDatabase } from "@/lib/provision";
import { MAX_ROWS } from "@/lib/query";

export const metadata = { title: "SQL Editor" };
export const dynamic = "force-dynamic";

export default async function SqlPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, id);
	if (!record) notFound();

	// Mongo and Redis need their own consoles rather than a SQL box (PLAN.md Q18).
	if (!ENGINE_CONFIG[record.engine].hasSql) notFound();

	return (
		<div className="space-y-8">
			<div>
				<Link
					href={`/databases/${id}`}
					className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
				>
					<ArrowLeft className="size-3.5" />
					{record.name}
				</Link>
			</div>

			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="flex items-center gap-3">
						<h1 className="font-semibold text-[34px] leading-tight tracking-tight">SQL Editor</h1>
						<StatusPill status={record.status} />
					</div>
					<p className="mt-2 text-muted-foreground text-sm">
						{record.dbName} · statements time out after {LIMITS.STATEMENT_TIMEOUT_MS / 1000}s ·
						first {MAX_ROWS} rows shown
					</p>
				</div>
			</div>

			<SqlEditor databaseId={record.id} />
		</div>
	);
}

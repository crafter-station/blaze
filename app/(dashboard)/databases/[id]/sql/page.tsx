import { notFound } from "next/navigation";
import { PageHeader } from "@/components/console/page";
import { SqlEditor } from "@/components/dashboard/sql-editor";
import { StatusPill } from "@/components/dashboard/status-pill";
import { requireUser } from "@/lib/auth";
import { ENGINE_CONFIG } from "@/lib/engines/types";
import { LIMITS } from "@/lib/limits";
import { getOwnedDatabase } from "@/lib/provision";
import { MAX_ROWS } from "@/lib/query";

export const metadata = { title: "SQL editor" };
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
			<PageHeader
				back={{ href: `/databases/${id}`, label: record.name }}
				title="SQL editor"
				meta={<StatusPill status={record.status} />}
				description={
					<>
						<span className="font-mono text-foreground/80">{record.dbName}</span>
						<span className="mx-2 text-border-strong">/</span>
						statements time out after {LIMITS.STATEMENT_TIMEOUT_MS / 1000}s, first {MAX_ROWS} rows
						shown
					</>
				}
			/>

			<SqlEditor databaseId={record.id} />
		</div>
	);
}

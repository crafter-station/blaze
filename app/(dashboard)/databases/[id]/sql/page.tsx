import { notFound } from "next/navigation";
import { SqlConsole } from "@/components/sql/console";
import { requireUser } from "@/lib/auth";
import { ENGINE_CONFIG } from "@/lib/engines/types";
import { env } from "@/lib/env";
import { LIMITS } from "@/lib/limits";
import { getOwnedDatabase } from "@/lib/provision";
import { MAX_ROWS } from "@/lib/query";
import { isSqlEngine } from "@/lib/sql/types";

export const metadata = { title: "SQL editor" };
export const dynamic = "force-dynamic";

export default async function SqlPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, id);
	if (!record) notFound();

	// Mongo and Redis need their own consoles rather than a SQL box (PLAN.md Q18).
	if (!ENGINE_CONFIG[record.engine].hasSql || !isSqlEngine(record.engine)) notFound();

	return (
		<>
			<h1 className="sr-only">SQL editor for {record.name}</h1>
			<SqlConsole
				databaseId={record.id}
				databaseName={record.name}
				engine={record.engine}
				roleName={record.roleName}
				timeoutSeconds={LIMITS.STATEMENT_TIMEOUT_MS / 1000}
				maxRows={MAX_ROWS}
				aiEnabled={Boolean(env.ANTHROPIC_API_KEY)}
			/>
		</>
	);
}

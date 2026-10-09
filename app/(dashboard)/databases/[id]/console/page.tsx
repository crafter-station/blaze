import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MongoShell } from "@/components/mongo/shell";
import { RedisConsole } from "@/components/redis/console";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { LIMITS } from "@/lib/limits";
import { MAX_DOCS } from "@/lib/mongo/run";
import { getOwnedDatabase } from "@/lib/provision";
import { BLOCKING_CAP_SECONDS } from "@/lib/redis/classify";
import { COMMAND_TIMEOUT_MS, TENANT_USER } from "@/lib/redis/tenant";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, id);
	return { title: record?.engine === "mongo" ? "Shell" : "Console" };
}

/** The console slot: the Redis console, or the Mongo shell. */
export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, id);

	if (record?.engine === "mongo") {
		return (
			<>
				<h1 className="sr-only">Mongo shell for {record.name}</h1>
				{/* useSearchParams (an "open in shell" command) needs a boundary. */}
				<Suspense>
					<MongoShell
						databaseId={record.id}
						databaseName={record.name}
						dbName={record.dbName}
						user={record.roleName}
						timeoutSeconds={LIMITS.STATEMENT_TIMEOUT_MS / 1000}
						maxDocs={MAX_DOCS}
						aiEnabled={Boolean(env.OPENAI_API_KEY)}
						suspended={record.status === "suspended"}
					/>
				</Suspense>
			</>
		);
	}
	if (record?.engine !== "redis") notFound();

	return (
		<>
			<h1 className="sr-only">Redis console for {record.name}</h1>
			{/* useSearchParams (an "open in console" command) needs a boundary. */}
			<Suspense>
				<RedisConsole
					databaseId={record.id}
					databaseName={record.name}
					user={TENANT_USER}
					timeoutSeconds={COMMAND_TIMEOUT_MS / 1000}
					blockingCapSeconds={BLOCKING_CAP_SECONDS}
					aiEnabled={Boolean(env.OPENAI_API_KEY)}
					suspended={record.status === "suspended"}
				/>
			</Suspense>
		</>
	);
}

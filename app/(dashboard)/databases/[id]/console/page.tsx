import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RedisConsole } from "@/components/redis/console";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { getOwnedDatabase } from "@/lib/provision";
import { BLOCKING_CAP_SECONDS } from "@/lib/redis/classify";
import { COMMAND_TIMEOUT_MS, TENANT_USER } from "@/lib/redis/tenant";

export const metadata = { title: "Console" };
export const dynamic = "force-dynamic";

export default async function RedisConsolePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, id);
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

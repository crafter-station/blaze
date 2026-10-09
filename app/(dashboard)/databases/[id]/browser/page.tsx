import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MongoBrowser } from "@/components/mongo/browser";
import { KeyBrowser } from "@/components/redis/browser";
import { requireUser } from "@/lib/auth";
import { LIMITS } from "@/lib/limits";
import { getOwnedDatabase } from "@/lib/provision";
import { TENANT_USER } from "@/lib/redis/tenant";

export const metadata = { title: "Browser" };
export const dynamic = "force-dynamic";

/** The Browser slot: Redis keys, or Mongo collections. Other engines have Tables instead. */
export default async function BrowserPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, id);
	if (record?.engine === "mongo") {
		return (
			<>
				<h1 className="sr-only">Collection browser for {record.name}</h1>
				{/* The selected collection lives in the URL (?c=), read with useSearchParams. */}
				<Suspense>
					<MongoBrowser
						databaseId={record.id}
						databaseName={record.name}
						storageLimit={LIMITS.STORAGE_BYTES}
						suspended={record.status === "suspended"}
					/>
				</Suspense>
			</>
		);
	}
	if (record?.engine !== "redis") notFound();

	return (
		<>
			<h1 className="sr-only">Key browser for {record.name}</h1>
			{/* The selected key lives in the URL (?key=), read with useSearchParams. */}
			<Suspense>
				<KeyBrowser
					databaseId={record.id}
					databaseName={record.name}
					user={TENANT_USER}
					memoryLimit={LIMITS.REDIS_MEMORY_BYTES}
					suspended={record.status === "suspended"}
				/>
			</Suspense>
		</>
	);
}

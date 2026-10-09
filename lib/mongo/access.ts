import "server-only";
import { requireUser } from "@/lib/auth";
import { getOwnedDatabase } from "@/lib/provision";
import type { Failure } from "./types";

export { assertCollectionName, describeMongoError, friendlyMongoError } from "./errors";

/**
 * Resolve a Mongo database the signed-in user owns, for the Browser and Shell actions.
 *
 * The id from the client is only ever a reference: ownership is checked against the session
 * on every call, exactly as the SQL and Redis consoles do. A database that does not exist
 * and one that belongs to someone else are indistinguishable from here.
 */

export type OwnedMongo = NonNullable<Awaited<ReturnType<typeof getOwnedDatabase>>>;

export async function ownedMongoDatabase(
	databaseId: string,
): Promise<{ record: OwnedMongo } | Failure> {
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, String(databaseId));
	if (record?.engine !== "mongo") return { ok: false, error: "Database not found" };
	if (record.status === "suspended") {
		return {
			ok: false,
			error:
				"This database is suspended because it is over its storage quota. Reads and writes are refused until it is back under the limit.",
		};
	}
	if (record.status !== "active") {
		return { ok: false, error: `This database is ${record.status} and cannot be queried yet.` };
	}
	return { record };
}

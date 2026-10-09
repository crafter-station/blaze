import "server-only";
import { MongoServerError } from "mongodb";
import { requireUser } from "@/lib/auth";
import { LIMITS } from "@/lib/limits";
import { getOwnedDatabase } from "@/lib/provision";
import { LiteralParseError } from "./literal";
import type { Failure } from "./types";

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

/** A plain reading of the engine errors people actually hit. */
export function friendlyMongoError(error: unknown): string | undefined {
	if (error instanceof MongoServerError) {
		switch (error.code) {
			case 13:
				return "Your database user can only reach this database, and has no roles while the database is suspended.";
			case 50:
				return `The operation ran longer than ${LIMITS.STATEMENT_TIMEOUT_MS / 1000}s and the server stopped it. Narrow the filter or add an index.`;
			case 11000:
				return "A unique index already has a document with this value.";
			case 26:
				return "That collection does not exist.";
			case 48:
				return "A collection with that name already exists.";
			case 27:
				return "No index has that name.";
			case 85:
			case 86:
				return "An index on these keys already exists with different options or name.";
			case 121:
				return "The collection's validator rejected this document.";
		}
		return undefined;
	}
	if (
		error instanceof Error &&
		/ECONNREFUSED|Server selection timed out|ENOTFOUND/.test(error.message)
	) {
		return "Could not reach the database server.";
	}
	return undefined;
}

export function describeMongoError(error: unknown, fallback = "MongoDB request failed"): Failure {
	if (error instanceof LiteralParseError) {
		return { ok: false, error: error.message, position: error.position };
	}
	const message = error instanceof Error ? error.message : fallback;
	const friendly = friendlyMongoError(error);
	return { ok: false, error: message, ...(friendly && { friendly }) };
}

/** Collection names the browser accepts: what MongoDB accepts, minus system namespaces. */
export function assertCollectionName(name: unknown): string {
	const value = String(name ?? "");
	if (!value || value.length > 120) throw new Error("Collection names are 1 to 120 characters.");
	if (value.includes("$") || value.includes("\0")) {
		throw new Error("Collection names cannot contain $ or a null character.");
	}
	if (value.startsWith("system.")) throw new Error("system.* collections belong to the server.");
	return value;
}

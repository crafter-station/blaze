import { MongoServerError } from "mongodb";
import { LIMITS } from "@/lib/limits";
import { LiteralParseError } from "./literal";
import type { Failure } from "./types";

/**
 * Errors as the Browser and Shell show them: the engine's own words, plus a plain reading
 * for the ones people actually hit. No Next or auth imports, so scripts can use it too.
 */

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

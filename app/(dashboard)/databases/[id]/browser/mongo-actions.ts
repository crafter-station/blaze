"use server";

import { assertCollectionName, describeMongoError, ownedMongoDatabase } from "@/lib/mongo/access";
import * as browse from "@/lib/mongo/browse";
import type { EJsonValue } from "@/lib/mongo/literal";
import type {
	DatabaseOverview,
	Failure,
	FindPage,
	FindRequest,
	IndexInfo,
} from "@/lib/mongo/types";

/**
 * Server actions behind the Mongo Browser.
 *
 * Every call resolves the database through ownership first (lib/mongo/access.ts), then
 * connects as the tenant's own Mongo user over TLS. That user's `dbOwner` role on its own
 * database is the boundary; nothing here grants or denies anything beyond it.
 */

const MAX_TEXT = 1_000_000;

function text(value: unknown, what: string): string {
	const s = String(value ?? "");
	if (s.length > MAX_TEXT) throw new Error(`${what} is longer than 1 MB.`);
	return s;
}

async function run<T>(
	databaseId: string,
	fn: (record: Parameters<typeof browse.find>[0]) => Promise<T>,
	fallback: string,
): Promise<({ ok: true } & T) | Failure> {
	const owned = await ownedMongoDatabase(databaseId);
	if ("error" in owned) return owned;
	try {
		return { ok: true, ...(await fn(owned.record)) };
	} catch (error) {
		return describeMongoError(error, fallback);
	}
}

export async function mongoOverviewAction(databaseId: string) {
	return run<{ overview: DatabaseOverview }>(
		databaseId,
		async (record) => ({ overview: await browse.overview(record) }),
		"Could not list collections",
	);
}

export async function mongoFindAction(databaseId: string, request: FindRequest) {
	return run<{ page: FindPage }>(
		databaseId,
		async (record) => ({
			page: await browse.find(record, {
				collection: assertCollectionName(request?.collection),
				filter: text(request?.filter, "The filter"),
				projection: text(request?.projection, "The projection"),
				sort: text(request?.sort, "The sort"),
				skip: Number(request?.skip ?? 0),
				limit: Number(request?.limit ?? 50),
			}),
		}),
		"Query failed",
	);
}

export async function mongoCountAction(databaseId: string, collection: string, filter: string) {
	return run<{ count: number }>(
		databaseId,
		async (record) => ({
			count: await browse.countMatching(
				record,
				assertCollectionName(collection),
				text(filter, "The filter"),
			),
		}),
		"Count failed",
	);
}

export async function mongoReplaceAction(
	databaseId: string,
	collection: string,
	id: EJsonValue,
	document: string,
) {
	return run<{ document: EJsonValue }>(
		databaseId,
		async (record) => ({
			document: await browse.replaceDocument(
				record,
				assertCollectionName(collection),
				id,
				text(document, "The document"),
			),
		}),
		"Could not save the document",
	);
}

export async function mongoInsertAction(databaseId: string, collection: string, document: string) {
	return run<{ insertedId: EJsonValue }>(
		databaseId,
		async (record) => ({
			insertedId: await browse.insertDocument(
				record,
				assertCollectionName(collection),
				text(document, "The document"),
			),
		}),
		"Could not insert the document",
	);
}

export async function mongoDeleteAction(databaseId: string, collection: string, id: EJsonValue) {
	return run<{ deleted: number }>(
		databaseId,
		async (record) => ({
			deleted: await browse.deleteDocument(record, assertCollectionName(collection), id),
		}),
		"Could not delete the document",
	);
}

export async function mongoIndexesAction(databaseId: string, collection: string) {
	return run<{ indexes: IndexInfo[] }>(
		databaseId,
		async (record) => ({
			indexes: await browse.listIndexes(record, assertCollectionName(collection)),
		}),
		"Could not list indexes",
	);
}

export async function mongoCreateIndexAction(databaseId: string, input: browse.CreateIndexInput) {
	return run<{ name: string }>(
		databaseId,
		async (record) => ({
			name: await browse.createIndex(record, {
				collection: assertCollectionName(input?.collection),
				keys: text(input?.keys, "The keys"),
				name: input?.name ? String(input.name).slice(0, 200) : undefined,
				unique: input?.unique === true,
				sparse: input?.sparse === true,
				expireAfterSeconds:
					input?.expireAfterSeconds === null || input?.expireAfterSeconds === undefined
						? null
						: Number(input.expireAfterSeconds),
				options: text(input?.options ?? "", "The options"),
			}),
		}),
		"Could not create the index",
	);
}

export async function mongoDropIndexAction(databaseId: string, collection: string, name: string) {
	return run<{ dropped: string }>(
		databaseId,
		async (record) => {
			await browse.dropIndex(record, assertCollectionName(collection), String(name));
			return { dropped: String(name) };
		},
		"Could not drop the index",
	);
}

export async function mongoCreateCollectionAction(
	databaseId: string,
	name: string,
	options: string,
) {
	return run<{ name: string }>(
		databaseId,
		async (record) => {
			const valid = assertCollectionName(name);
			await browse.createCollection(record, valid, text(options, "The options"));
			return { name: valid };
		},
		"Could not create the collection",
	);
}

/** `typed` must equal the name: a request that skipped the dialog cannot drop anything. */
export async function mongoDropCollectionAction(databaseId: string, name: string, typed: string) {
	return run<{ dropped: string }>(
		databaseId,
		async (record) => {
			const valid = assertCollectionName(name);
			if (typed !== valid) throw new Error("Type the collection name to confirm.");
			await browse.dropCollection(record, valid);
			return { dropped: valid };
		},
		"Could not drop the collection",
	);
}

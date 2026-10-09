import "server-only";
import { BSON, type Db } from "mongodb";
import { LIMITS } from "@/lib/limits";
import type { OwnedMongo } from "./access";
import { displayDocuments, fromEJson, parseBsonDocument, toDisplay } from "./ejson";
import { type EJsonValue, isObject, LiteralParseError, parseLiteral } from "./literal";
import { type CollectionShape, inferShape, SAMPLE_SIZE } from "./schema";
import { withTenantMongo } from "./tenant";
import type {
	CollectionSummary,
	DatabaseOverview,
	FindPage,
	FindRequest,
	IndexInfo,
} from "./types";

/**
 * What the Browser does, as the tenant. Every operation carries `maxTimeMS`, so a slow
 * filter returns an error instead of a hung request — the server-side `defaultMaxTimeMS`
 * would catch reads anyway, but writes are not covered by it.
 */

export const PAGE_SIZES = [20, 50, 100, 200] as const;
export const MAX_PAGE = 200;
const MAX_COLLECTIONS = 500;
const OP_TIMEOUT = LIMITS.STATEMENT_TIMEOUT_MS;

async function summary(db: Db, name: string, type: string): Promise<CollectionSummary> {
	const base: CollectionSummary = {
		name,
		type: type === "view" ? "view" : type === "timeseries" ? "timeseries" : "collection",
		count: null,
		storageSize: null,
		dataSize: null,
		indexCount: null,
		totalIndexSize: null,
	};
	if (base.type === "view") return base;
	try {
		const [stats] = await db
			.collection(name)
			.aggregate([{ $collStats: { storageStats: {} } }], { maxTimeMS: 5_000 })
			.toArray();
		const s = stats?.storageStats ?? {};
		return {
			...base,
			count: Number(s.count ?? 0),
			storageSize: Number(s.storageSize ?? 0),
			dataSize: Number(s.size ?? 0),
			indexCount: Number(s.nindexes ?? 0),
			totalIndexSize: Number(s.totalIndexSize ?? 0),
		};
	} catch {
		try {
			return {
				...base,
				count: await db.collection(name).estimatedDocumentCount({ maxTimeMS: 5_000 }),
			};
		} catch {
			return base;
		}
	}
}

export async function overview(record: OwnedMongo): Promise<DatabaseOverview> {
	return withTenantMongo(record, async (db) => {
		const infos = await db
			.listCollections({}, { nameOnly: false, authorizedCollections: true })
			.toArray();
		const visible = infos
			.filter((c) => !c.name.startsWith("system."))
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, MAX_COLLECTIONS);
		const collections = await Promise.all(visible.map((c) => summary(db, c.name, c.type ?? "")));
		const stats = await db.command({ dbStats: 1 });
		return {
			collections,
			storageSize: Number(stats.storageSize ?? 0),
			dataSize: Number(stats.dataSize ?? 0),
			objects: Number(stats.objects ?? 0),
			indexes: Number(stats.indexes ?? 0),
			indexSize: Number(stats.indexSize ?? 0),
		};
	});
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = Number(value);
	return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export async function find(record: OwnedMongo, request: FindRequest): Promise<FindPage> {
	const filter = parseBsonDocument(request.filter, "The filter");
	const projection = parseBsonDocument(request.projection, "The projection");
	const sort = parseBsonDocument(request.sort, "The sort");
	const skip = clampInt(request.skip, 0, 10_000_000, 0);
	const limit = clampInt(request.limit, 1, MAX_PAGE, 50);

	return withTenantMongo(record, async (db) => {
		const started = Date.now();
		const docs = await db
			.collection(request.collection)
			.find(filter, {
				projection: Object.keys(projection).length ? projection : undefined,
				sort: Object.keys(sort).length ? sort : undefined,
				skip,
				limit: limit + 1,
				maxTimeMS: OP_TIMEOUT,
			})
			.toArray();
		const durationMs = Date.now() - started;
		const page = displayDocuments(docs.slice(0, limit));
		return {
			docs: page.docs,
			hasMore: docs.length > limit || page.clipped,
			clipped: page.clipped,
			durationMs,
		};
	});
}

export async function countMatching(record: OwnedMongo, collection: string, filterText: string) {
	const filter = parseBsonDocument(filterText, "The filter");
	return withTenantMongo(record, (db) =>
		Object.keys(filter).length
			? db.collection(collection).countDocuments(filter, { maxTimeMS: 10_000 })
			: db.collection(collection).estimatedDocumentCount({ maxTimeMS: 10_000 }),
	);
}

/** `_id` from the browser: display Extended JSON, turned back into its BSON type. */
function idFrom(value: EJsonValue): unknown {
	return isObject(value) || Array.isArray(value) ? fromEJson(value) : value;
}

function parseDocumentText(text: string): BSON.Document {
	const value = parseLiteral(text);
	if (!isObject(value)) throw new LiteralParseError("A document must be { … }", 0);
	return fromEJson<BSON.Document>(value);
}

export async function replaceDocument(
	record: OwnedMongo,
	collection: string,
	id: EJsonValue,
	text: string,
): Promise<EJsonValue> {
	const doc = parseDocumentText(text);
	const _id = idFrom(id);
	if ("_id" in doc && BSON.EJSON.stringify({ v: doc._id }) !== BSON.EJSON.stringify({ v: _id })) {
		throw new Error("_id cannot be changed. Insert a new document and delete this one instead.");
	}
	return withTenantMongo(record, async (db) => {
		const result = await db
			.collection(collection)
			.replaceOne({ _id } as BSON.Document, { ...doc, _id } as BSON.Document, {
				maxTimeMS: OP_TIMEOUT,
			});
		if (result.matchedCount === 0) {
			throw new Error("The document no longer exists. Reload to see the current data.");
		}
		const fresh = await db
			.collection(collection)
			.findOne({ _id } as BSON.Document, { maxTimeMS: OP_TIMEOUT });
		return toDisplay(fresh);
	});
}

export async function insertDocument(
	record: OwnedMongo,
	collection: string,
	text: string,
): Promise<EJsonValue> {
	const doc = parseDocumentText(text);
	return withTenantMongo(record, async (db) => {
		const result = await db.collection(collection).insertOne(doc, { maxTimeMS: OP_TIMEOUT });
		return toDisplay(result.insertedId);
	});
}

export async function deleteDocument(record: OwnedMongo, collection: string, id: EJsonValue) {
	const _id = idFrom(id);
	return withTenantMongo(record, async (db) => {
		const result = await db
			.collection(collection)
			.deleteOne({ _id } as BSON.Document, { maxTimeMS: OP_TIMEOUT });
		return result.deletedCount;
	});
}

export async function listIndexes(record: OwnedMongo, collection: string): Promise<IndexInfo[]> {
	return withTenantMongo(record, async (db) => {
		const coll = db.collection(collection);
		const indexes = await coll.listIndexes({ maxTimeMS: OP_TIMEOUT }).toArray();
		let sizes: Record<string, number> = {};
		try {
			const [stats] = await coll
				.aggregate([{ $collStats: { storageStats: {} } }], { maxTimeMS: 5_000 })
				.toArray();
			sizes = (stats?.storageStats?.indexSizes ?? {}) as Record<string, number>;
		} catch {}
		return indexes.map((index) => {
			const { v, key, name, unique, sparse, expireAfterSeconds, partialFilterExpression, ...rest } =
				index;
			void v;
			const extra: Record<string, EJsonValue> = {};
			for (const [k, value] of Object.entries(rest)) extra[k] = toDisplay(value);
			return {
				name: String(name),
				key: toDisplay(key),
				unique: Boolean(unique),
				sparse: Boolean(sparse),
				expireAfterSeconds: typeof expireAfterSeconds === "number" ? expireAfterSeconds : null,
				partialFilterExpression: partialFilterExpression
					? toDisplay(partialFilterExpression)
					: null,
				extra,
				size: typeof sizes[String(name)] === "number" ? Number(sizes[String(name)]) : null,
			};
		});
	});
}

export interface CreateIndexInput {
	collection: string;
	keys: string;
	name?: string;
	unique?: boolean;
	sparse?: boolean;
	expireAfterSeconds?: number | null;
	options?: string;
}

export async function createIndex(record: OwnedMongo, input: CreateIndexInput): Promise<string> {
	const keys = parseBsonDocument(input.keys, "The index keys");
	if (Object.keys(keys).length === 0) throw new Error("The index needs at least one field.");
	const options: BSON.Document = parseBsonDocument(input.options ?? "", "The options");
	if (input.name?.trim()) options.name = input.name.trim();
	if (input.unique) options.unique = true;
	if (input.sparse) options.sparse = true;
	if (typeof input.expireAfterSeconds === "number") {
		if (!Number.isInteger(input.expireAfterSeconds) || input.expireAfterSeconds < 0) {
			throw new Error("The TTL must be a whole number of seconds.");
		}
		options.expireAfterSeconds = input.expireAfterSeconds;
	}
	return withTenantMongo(record, (db) =>
		db.collection(input.collection).createIndex(keys, { ...options, maxTimeMS: OP_TIMEOUT }),
	);
}

export async function dropIndex(record: OwnedMongo, collection: string, name: string) {
	if (name === "_id_") throw new Error("The _id index cannot be dropped.");
	await withTenantMongo(record, (db) =>
		db.collection(collection).dropIndex(name, { maxTimeMS: OP_TIMEOUT }),
	);
}

export async function createCollection(record: OwnedMongo, name: string, optionsText: string) {
	const options = parseBsonDocument(optionsText, "The options");
	await withTenantMongo(record, (db) => db.createCollection(name, options));
}

export async function dropCollection(record: OwnedMongo, name: string) {
	await withTenantMongo(record, (db) => db.collection(name).drop());
}

/**
 * Keys and BSON types of up to `SAMPLE_SIZE` documents per collection. Values never leave
 * this function: `inferShape` keeps only paths and type names.
 */
export async function sampleShapes(record: OwnedMongo): Promise<CollectionShape[]> {
	return withTenantMongo(record, async (db) => {
		const infos = await db
			.listCollections({}, { nameOnly: true, authorizedCollections: true })
			.toArray();
		const names = infos
			.map((c) => c.name)
			.filter((n) => !n.startsWith("system."))
			.sort()
			.slice(0, 60);
		return Promise.all(
			names.map(async (name) => {
				try {
					const docs = await db
						.collection(name)
						.find({}, { limit: SAMPLE_SIZE, maxTimeMS: 5_000 })
						.toArray();
					return inferShape(
						name,
						docs.map((d) => toDisplay(d)),
					);
				} catch {
					return inferShape(name, []);
				}
			}),
		);
	});
}

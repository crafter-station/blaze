import "server-only";
import { type BSON, type Db, MongoServerError } from "mongodb";
import { LIMITS } from "@/lib/limits";
import type { OwnedMongo } from "./access";
import { RAW } from "./browse";
import { classify } from "./classify";
import { displayDocuments, fromEJson, MAX_RESPONSE_BYTES, toDisplay } from "./ejson";
import { friendlyMongoError } from "./errors";
import { type EJsonValue, isObject, LiteralParseError } from "./literal";
import { type CursorOptions, parseShell, type ShellCommand } from "./shell";
import { withTenantMongo } from "./tenant";
import type { ShellOutcome, ShellResult } from "./types";

/**
 * Runs one parsed shell command as the tenant.
 *
 * The parser has already decided *what* this is (lib/mongo/shell.ts); here it becomes one
 * driver call, never evaluated code. Every call carries `maxTimeMS`, capped at the
 * statement timeout even when the user asks for more, and results are capped at
 * `MAX_DOCS` documents and `MAX_RESPONSE_BYTES`, with a note when anything was held back.
 */

export const MAX_DOCS = 500;
const TIMEOUT = LIMITS.STATEMENT_TIMEOUT_MS;

/** Options a user may not set from the shell: the console owns its own session. */
const STRIPPED_OPTIONS = ["session", "explicitlyIgnoreSession", "timeoutMS"];

function options(value: EJsonValue | undefined): BSON.Document {
	if (!isObject(value)) return { maxTimeMS: TIMEOUT };
	const out = fromEJson<BSON.Document>(value);
	for (const key of STRIPPED_OPTIONS) delete out[key];
	const asked = Number(out.maxTimeMS);
	out.maxTimeMS = Number.isFinite(asked) && asked > 0 ? Math.min(asked, TIMEOUT) : TIMEOUT;
	return out;
}

function doc(value: EJsonValue | undefined): BSON.Document {
	return isObject(value) ? fromEJson<BSON.Document>(value) : {};
}

function documents(raw: unknown[], truncated: boolean): ShellResult {
	const page = displayDocuments(raw.slice(0, MAX_DOCS));
	return { kind: "documents", docs: page.docs, truncated, clipped: page.clipped };
}

function value(raw: unknown): ShellResult {
	const shown = toDisplay(raw);
	const size = JSON.stringify(shown)?.length ?? 0;
	if (size > MAX_RESPONSE_BYTES) {
		return {
			kind: "text",
			text: `The result is ${(size / 1024 / 1024).toFixed(1)} MB, more than the shell shows. Narrow the command.`,
		};
	}
	return { kind: "value", value: shown };
}

/** A database command's reply, with a cursor's first batch capped like a find. */
function commandReply(raw: BSON.Document): { result: ShellResult; note?: string } {
	const batch = raw?.cursor?.firstBatch;
	if (Array.isArray(batch) && batch.length > MAX_DOCS) {
		raw.cursor.firstBatch = batch.slice(0, MAX_DOCS);
		return {
			result: value(raw),
			note: `Showing the first ${MAX_DOCS} documents of the batch.`,
		};
	}
	return { result: value(raw) };
}

function findOptions(args: EJsonValue[], cursor: CursorOptions): BSON.Document {
	const base = options(args[2]);
	const projection = cursor.projection ?? (isObject(args[1]) ? args[1] : undefined);
	if (projection && Object.keys(projection).length) base.projection = fromEJson(projection);
	if (cursor.sort) base.sort = fromEJson(cursor.sort);
	if (cursor.skip !== undefined) base.skip = cursor.skip;
	if (cursor.hint !== undefined) base.hint = fromEJson(cursor.hint);
	if (cursor.collation) base.collation = fromEJson(cursor.collation);
	if (cursor.comment !== undefined) base.comment = fromEJson(cursor.comment);
	if (cursor.maxTimeMS) base.maxTimeMS = Math.min(cursor.maxTimeMS, TIMEOUT);
	return base;
}

async function execute(
	db: Db,
	command: ShellCommand,
	dbName: string,
): Promise<{ result: ShellResult; note?: string }> {
	switch (command.type) {
		case "blocked":
			throw new Error(command.reason);
		case "show": {
			if (command.what === "dbs") {
				const reply = await db
					.admin()
					.command({ listDatabases: 1, nameOnly: false, authorizedDatabases: true });
				const lines = (reply.databases as { name: string; sizeOnDisk?: number }[]).map(
					(d) => `${d.name}  ${((Number(d.sizeOnDisk) || 0) / 1024).toFixed(0)} KB`,
				);
				return {
					result: { kind: "text", text: lines.join("\n") || dbName },
					note: "Your user can only see this database.",
				};
			}
			const names = (
				await db.listCollections({}, { nameOnly: true, authorizedCollections: true }).toArray()
			)
				.map((c) => c.name)
				.sort();
			return { result: { kind: "text", text: names.join("\n") || "(no collections)" } };
		}
		case "command":
			// Commands take no maxTimeMS option; the driver's timeoutMS bounds the round trip.
			return commandReply(
				await db.command(fromEJson<BSON.Document>(command.command), { timeoutMS: TIMEOUT + 2_000 }),
			);
		case "db":
			switch (command.method) {
				case "getCollectionNames": {
					const names = (
						await db.listCollections({}, { nameOnly: true, authorizedCollections: true }).toArray()
					)
						.map((c) => c.name)
						.sort();
					return { result: value(names) };
				}
				case "getCollectionInfos":
					return {
						result: value(
							await db
								.listCollections(doc(command.args[0]), { authorizedCollections: true })
								.toArray(),
						),
					};
				case "createCollection":
					await db.createCollection(String(command.args[0]), doc(command.args[1]));
					return { result: value({ ok: 1 }) };
				case "stats": {
					const scale = typeof command.args[0] === "number" ? command.args[0] : undefined;
					return { result: value(await db.command({ dbStats: 1, ...(scale && { scale }) })) };
				}
				case "dropDatabase":
					return { result: value({ ok: await db.dropDatabase(), dropped: dbName }) };
				case "getName":
					return { result: { kind: "text", text: dbName } };
			}
			break;
		case "collection": {
			const coll = db.collection(command.collection);
			const { args, cursor } = command;
			switch (command.method) {
				case "find": {
					const opts = findOptions(args, cursor);
					if (cursor.count) {
						const countOpts: BSON.Document = { maxTimeMS: opts.maxTimeMS };
						if (cursor.skip !== undefined) countOpts.skip = cursor.skip;
						if (cursor.limit) countOpts.limit = cursor.limit;
						return {
							result: { kind: "count", value: await coll.countDocuments(doc(args[0]), countOpts) },
						};
					}
					const asked = cursor.limit && cursor.limit > 0 ? cursor.limit : null;
					const limit = asked !== null && asked <= MAX_DOCS ? asked : MAX_DOCS + 1;
					const docs = await coll.find(doc(args[0]), { ...opts, ...RAW, limit }).toArray();
					const truncated = docs.length > MAX_DOCS;
					return {
						result: documents(docs, truncated),
						...(truncated && {
							note: `Showing the first ${MAX_DOCS} documents. Add a filter, .limit() or .skip() to see others.`,
						}),
					};
				}
				case "findOne": {
					const opts = findOptions(args, cursor);
					return { result: value(await coll.findOne(doc(args[0]), { ...opts, ...RAW })) };
				}
				case "aggregate": {
					const pipeline = (args[0] as EJsonValue[]).map((stage) =>
						fromEJson<BSON.Document>(stage),
					);
					const out: unknown[] = [];
					const cursorHandle = coll.aggregate(pipeline, { ...options(args[1]), ...RAW });
					try {
						for await (const item of cursorHandle) {
							out.push(item);
							if (out.length > MAX_DOCS) break;
						}
					} finally {
						await cursorHandle.close().catch(() => {});
					}
					const truncated = out.length > MAX_DOCS;
					return {
						result: documents(out, truncated),
						...(truncated && {
							note: `Showing the first ${MAX_DOCS} results. Add a $limit stage to choose which.`,
						}),
					};
				}
				case "countDocuments":
					return {
						result: {
							kind: "count",
							value: await coll.countDocuments(doc(args[0]), options(args[1])),
						},
					};
				case "estimatedDocumentCount":
					return {
						result: { kind: "count", value: await coll.estimatedDocumentCount(options(args[0])) },
					};
				case "distinct": {
					const values = await coll.distinct(String(args[0]), doc(args[1]), options(args[2]));
					const truncated = values.length > 5_000;
					return {
						result: value(values.slice(0, 5_000)),
						...(truncated && {
							note: `Showing 5,000 of ${values.length.toLocaleString()} values.`,
						}),
					};
				}
				case "insertOne":
					return { result: value(await coll.insertOne(doc(args[0]), options(args[1]))) };
				case "insertMany":
					return {
						result: value(
							await coll.insertMany(
								(args[0] as EJsonValue[]).map((d) => doc(d)),
								options(args[1]),
							),
						),
					};
				case "updateOne":
				case "updateMany": {
					const update = Array.isArray(args[1])
						? args[1].map((stage) => fromEJson<BSON.Document>(stage))
						: doc(args[1]);
					const run =
						command.method === "updateOne" ? coll.updateOne.bind(coll) : coll.updateMany.bind(coll);
					return { result: value(await run(doc(args[0]), update, options(args[2]))) };
				}
				case "replaceOne":
					return {
						result: value(await coll.replaceOne(doc(args[0]), doc(args[1]), options(args[2]))),
					};
				case "deleteOne":
					return { result: value(await coll.deleteOne(doc(args[0]), options(args[1]))) };
				case "deleteMany":
					return { result: value(await coll.deleteMany(doc(args[0]), options(args[1]))) };
				case "createIndex":
					return { result: value(await coll.createIndex(doc(args[0]), options(args[1]))) };
				case "dropIndex": {
					const target = typeof args[0] === "string" ? args[0] : doc(args[0]);
					return { result: value(await coll.dropIndex(target as string, { maxTimeMS: TIMEOUT })) };
				}
				case "getIndexes":
					return {
						result: documents(await coll.listIndexes({ maxTimeMS: TIMEOUT }).toArray(), false),
					};
				case "drop":
					return { result: value(await coll.drop()) };
			}
		}
	}
	throw new Error("Unsupported command");
}

/**
 * Parse, classify and run one command.
 *
 * `confirmed` must be `true` for a command that needs confirmation, or the database name
 * itself for one that needs it typed (dropDatabase): a request that skipped the dialog —
 * a stale tab, a script — cannot drop anything by accident.
 */
export async function runShell(
	record: OwnedMongo,
	source: string,
	confirmed: boolean | string,
): Promise<ShellOutcome> {
	const started = Date.now();
	const done = (outcome: Omit<ShellOutcome, "source" | "durationMs">): ShellOutcome => ({
		source,
		durationMs: Date.now() - started,
		...outcome,
	});

	let command: ShellCommand;
	try {
		command = parseShell(source);
	} catch (error) {
		if (error instanceof LiteralParseError) {
			return done({ ok: false, kind: "syntax", error: error.message, position: error.position });
		}
		throw error;
	}

	const verdict = classify(command, record.dbName);
	if (verdict.blocked) {
		return done({ ok: false, kind: "blocked", label: verdict.label, error: verdict.blocked });
	}
	if (verdict.confirm) {
		const ok = verdict.confirm.typeToConfirm
			? confirmed === verdict.confirm.typeToConfirm
			: confirmed === true;
		if (!ok) {
			return done({
				ok: false,
				kind: "confirm",
				label: verdict.label,
				confirm: verdict.confirm,
				error: `Not run without confirmation. ${verdict.confirm.message}`,
			});
		}
	}

	try {
		const { result, note } = await withTenantMongo(record, (db) =>
			execute(db, command, record.dbName),
		);
		return done({ ok: true, label: verdict.label, result, ...(note && { note }) });
	} catch (error) {
		const message = error instanceof Error ? error.message : "The command failed.";
		const friendly = friendlyMongoError(error);
		return done({
			ok: false,
			label: verdict.label,
			kind:
				error instanceof MongoServerError ||
				!/Network|ServerSelection|Topology/.test(String((error as Error)?.name))
					? "server"
					: "connection",
			error: message,
			...(friendly && { friendly }),
		});
	}
}

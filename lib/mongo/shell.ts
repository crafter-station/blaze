import { type EJsonObject, type EJsonValue, isObject, LiteralParseError, Scanner } from "./literal";

/**
 * mongosh-style commands, parsed into a plain description of what to run — never evaluated.
 *
 * The grammar is the part of the shell people actually use against one database:
 *
 *   db.<coll>.<method>(args…)[.sort(…)|.limit(n)|.skip(n)|.project(…)|.count()|.toArray()]…
 *   db.getCollection("name").<method>(…)      db["odd name"].<method>(…)
 *   db.getCollectionNames()  db.createCollection(name, options?)  db.stats()
 *   db.dropDatabase()  db.runCommand({ … })   show collections   { "ping": 1 }
 *
 * Arguments go through `literal.ts`, so they can use relaxed JSON and the shell's type
 * constructors. Anything else (`use`, loops, variables, arbitrary JavaScript) is a parse
 * error with an explanation, not something to attempt.
 */

export const COLLECTION_METHODS = [
	"find",
	"findOne",
	"aggregate",
	"countDocuments",
	"estimatedDocumentCount",
	"distinct",
	"insertOne",
	"insertMany",
	"updateOne",
	"updateMany",
	"replaceOne",
	"deleteOne",
	"deleteMany",
	"createIndex",
	"dropIndex",
	"getIndexes",
	"drop",
] as const;
export type CollectionMethod = (typeof COLLECTION_METHODS)[number];

/** Methods mongosh has that the shell recognises only to refuse with a reason. */
export const BLOCKED_COLLECTION_METHODS: Record<string, string> = {
	watch:
		"watch() opens a change stream that stays open for as long as you listen. The shell runs each command on a short-lived connection, so use mongosh or a driver for change streams.",
	mapReduce: "mapReduce is deprecated in MongoDB. Use aggregate() with a pipeline instead.",
};

export const DB_METHODS = [
	"getCollectionNames",
	"getCollectionInfos",
	"createCollection",
	"stats",
	"dropDatabase",
	"runCommand",
	"getName",
] as const;
export type DbMethod = Exclude<(typeof DB_METHODS)[number], "runCommand">;

const BLOCKED_DB_METHODS: Record<string, string> = {
	watch: BLOCKED_COLLECTION_METHODS.watch,
	adminCommand:
		"adminCommand runs against the admin database, which belongs to the server, not to your database. Use db.runCommand({ … }).",
	getSiblingDB:
		"Your user can only reach this database, so there is no sibling database to switch to.",
	getMongo: "The shell does not expose the connection object.",
	auth: "The shell is already authenticated as this database's own user.",
	createUser: "Users are managed by blaze; this database has exactly one user.",
	dropUser: "Users are managed by blaze; this database has exactly one user.",
};

/** Methods that may follow `find(…)`. */
export const CURSOR_METHODS = [
	"sort",
	"limit",
	"skip",
	"project",
	"projection",
	"count",
	"toArray",
	"pretty",
	"batchSize",
	"hint",
	"maxTimeMS",
	"collation",
	"comment",
] as const;

const BLOCKED_CURSOR_METHODS: Record<string, string> = {
	tailable:
		"Tailable cursors wait for new documents on a connection that stays open. The shell's connection closes after each command, so use mongosh or a driver for this.",
	addCursorFlag:
		"Cursor flags such as tailable or noCursorTimeout need a cursor that outlives the request. The shell reads one batch and closes it.",
	noCursorTimeout: "The shell's cursors close as soon as the command finishes.",
	forEach:
		"The shell does not run JavaScript. Results are printed for you; use .toArray() or nothing at all.",
	map: "The shell does not run JavaScript. Use an aggregation $project to reshape documents.",
	next: "The shell reads the first batch for you; there is no cursor to iterate.",
	hasNext: "The shell reads the first batch for you; there is no cursor to iterate.",
	explain: 'Use db.runCommand({ explain: { find: "<collection>", filter: { … } } }) instead.',
};

export interface CursorOptions {
	sort?: EJsonObject;
	limit?: number;
	skip?: number;
	projection?: EJsonObject;
	hint?: EJsonValue;
	collation?: EJsonObject;
	comment?: EJsonValue;
	maxTimeMS?: number;
	/** `.count()` on a find: count the matches rather than return them. */
	count?: boolean;
}

export type ShellCommand =
	| { type: "show"; what: "collections" | "dbs" }
	| { type: "db"; method: DbMethod; args: EJsonValue[] }
	| { type: "command"; command: EJsonObject }
	| {
			type: "collection";
			collection: string;
			method: CollectionMethod;
			args: EJsonValue[];
			cursor: CursorOptions;
	  }
	| { type: "blocked"; reason: string; name: string };

interface Segment {
	name: string;
	/** Present when the segment was called: `.find(…)`. */
	args?: EJsonValue[];
	at: number;
}

function err(message: string, at: number): never {
	throw new LiteralParseError(message, at);
}

/**
 * Parse one shell command. Throws `LiteralParseError` with a position on anything it
 * cannot read, so the editor can underline the exact spot.
 */
export function parseShell(source: string): ShellCommand {
	const trimmed = source.trim();
	if (!trimmed) err("Nothing to run", 0);

	const show = /^show\s+(\w+)\s*;?\s*$/i.exec(trimmed);
	if (show) {
		const what = show[1].toLowerCase();
		if (what === "collections" || what === "tables") return { type: "show", what: "collections" };
		if (what === "dbs" || what === "databases") return { type: "show", what: "dbs" };
		err(`"show ${show[1]}" is not supported. Try "show collections".`, source.indexOf(show[1]));
	}
	const use = /^use\s+(\S+)/i.exec(trimmed);
	if (use) {
		err(
			"Each blaze database is its own tenant, and this shell is already connected to it. There is no other database to use.",
			source.indexOf(use[0]),
		);
	}

	const sc = new Scanner(source);
	sc.skip();

	// A bare document is a database command: { "ping": 1 }.
	if (sc.peek() === "{") {
		const command = sc.object();
		finish(sc);
		return commandOf(command, 0);
	}

	const rootAt = sc.pos;
	const root = sc.identifier();
	if (root !== "db") {
		if (root === null) err(`Expected "db." or a command document`, rootAt);
		err(
			`The shell understands db.<collection>.<method>(…), "show collections" and { command } documents. "${root}" is not one of them; the shell does not run JavaScript.`,
			rootAt,
		);
	}

	const segments: Segment[] = [];
	while (true) {
		sc.skip();
		const at = sc.pos;
		let name: string | null = null;
		if (sc.eat(".")) {
			name = sc.identifier();
			if (name === null) err('Expected a name after "."', sc.pos);
		} else if (sc.peek() === "[") {
			sc.pos++;
			sc.skip();
			name = sc.string();
			sc.expect("]");
		} else {
			break;
		}
		// Refused methods are recognised by name alone: their arguments are usually
		// JavaScript (`forEach(printjson)`), which is exactly what is not parsed.
		const refusal =
			segments.length === 0
				? BLOCKED_DB_METHODS[name]
				: (BLOCKED_COLLECTION_METHODS[name] ?? BLOCKED_CURSOR_METHODS[name]);
		if (refusal && sc.eat("(")) {
			return { type: "blocked", name: `.${name}()`, reason: refusal };
		}
		let args: EJsonValue[] | undefined;
		if (sc.eat("(")) args = sc.callArgs();
		segments.push({ name, args, at });
	}
	finish(sc);

	if (segments.length === 0) err("Expected db.<collection>.<method>(…)", sc.pos);
	return interpret(segments);
}

function finish(sc: Scanner): void {
	sc.eat(";");
	if (!sc.done) {
		err(
			`Unexpected "${sc.peek()}". Run one command at a time; the shell does not run JavaScript.`,
			sc.pos,
		);
	}
}

function commandOf(command: EJsonObject, at: number): ShellCommand {
	if (Object.keys(command).length === 0) err("A command document needs a command name", at);
	return { type: "command", command };
}

function interpret(segments: Segment[]): ShellCommand {
	const [first] = segments;

	// db.<method>(…)
	if (first.args && first.name !== "getCollection") {
		if (segments.length > 1) err(`Nothing can follow db.${first.name}()`, segments[1].at);
		if (BLOCKED_DB_METHODS[first.name]) {
			return { type: "blocked", name: `db.${first.name}`, reason: BLOCKED_DB_METHODS[first.name] };
		}
		if (first.name === "runCommand") {
			const [command] = first.args;
			if (typeof command === "string") return commandOf({ [command]: 1 }, first.at);
			if (!isObject(command) || first.args.length !== 1) {
				err("db.runCommand() takes one command document", first.at);
			}
			return commandOf(command, first.at);
		}
		if (!(DB_METHODS as readonly string[]).includes(first.name)) {
			err(
				`db.${first.name}() is not supported. Database methods: ${DB_METHODS.map((m) => `${m}()`).join(", ")}. For a collection, write db.${first.name}.find().`,
				first.at,
			);
		}
		const method = first.name as DbMethod;
		validateDbArgs(method, first.args, first.at);
		return { type: "db", method, args: first.args };
	}

	// Collection: db.getCollection("x") / db["x"] / db.x / db.a.b (a collection named "a.b").
	let collection: string;
	let rest: Segment[];
	if (first.name === "getCollection" && first.args) {
		const [name] = first.args;
		if (typeof name !== "string" || first.args.length !== 1) {
			err("db.getCollection() takes the collection name as a string", first.at);
		}
		collection = name;
		rest = segments.slice(1);
	} else {
		const nameParts: string[] = [];
		let i = 0;
		while (i < segments.length && !segments[i].args) {
			nameParts.push(segments[i].name);
			i++;
		}
		// The last uncalled part is a property access the shell cannot evaluate.
		if (i === segments.length) {
			err(`Add a method, e.g. db.${nameParts.join(".")}.find()`, segments[segments.length - 1].at);
		}
		collection = nameParts.join(".");
		rest = segments.slice(i);
	}
	if (!collection) err("Missing collection name", first.at);

	const [call, ...chain] = rest;
	if (!call?.args) err(`Expected a method call on "${collection}"`, call?.at ?? first.at);

	if (BLOCKED_COLLECTION_METHODS[call.name]) {
		return {
			type: "blocked",
			name: `db.${collection}.${call.name}`,
			reason: BLOCKED_COLLECTION_METHODS[call.name],
		};
	}
	if (!(COLLECTION_METHODS as readonly string[]).includes(call.name)) {
		err(
			`${call.name}() is not supported on a collection. Supported: ${COLLECTION_METHODS.join(", ")}.`,
			call.at,
		);
	}
	const method = call.name as CollectionMethod;
	const args = normalizeArgs(method, call.args, call.at);

	const cursor: CursorOptions = {};
	for (const seg of chain) {
		if (!seg.args) err(`Expected .${seg.name}(…) to be called`, seg.at);
		if (BLOCKED_CURSOR_METHODS[seg.name]) {
			return {
				type: "blocked",
				name: `.${seg.name}()`,
				reason: BLOCKED_CURSOR_METHODS[seg.name],
			};
		}
		applyCursor(method, cursor, seg);
	}

	// A tailable cursor asked for through find's options is the same thing as .tailable().
	if (method === "find" && isObject(args[2]) && (args[2].tailable || args[2].awaitData)) {
		return {
			type: "blocked",
			name: ".find({ tailable })",
			reason: BLOCKED_CURSOR_METHODS.tailable,
		};
	}
	if (method === "aggregate" && Array.isArray(args[0])) {
		const changeStream = args[0].some((stage) => isObject(stage) && "$changeStream" in stage);
		if (changeStream) {
			return { type: "blocked", name: "$changeStream", reason: BLOCKED_COLLECTION_METHODS.watch };
		}
	}

	return { type: "collection", collection, method, args, cursor };
}

function applyCursor(method: CollectionMethod, cursor: CursorOptions, seg: Segment): void {
	const args = seg.args ?? [];
	const name = seg.name;
	if (name === "toArray" || name === "pretty") {
		if (args.length) err(`.${name}() takes no arguments`, seg.at);
		return;
	}
	if (method === "aggregate") {
		err(`.${name}() cannot follow aggregate(). Add a stage to the pipeline instead.`, seg.at);
	}
	if (method !== "find") err(`.${name}() can only follow find()`, seg.at);
	if (!(CURSOR_METHODS as readonly string[]).includes(name)) {
		err(`.${name}() is not supported. Cursor methods: ${CURSOR_METHODS.join(", ")}.`, seg.at);
	}
	const one = () => {
		if (args.length !== 1) err(`.${name}() takes one argument`, seg.at);
		return args[0];
	};
	const count = (v: EJsonValue) => {
		if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
			err(`.${name}() takes a non-negative integer`, seg.at);
		}
		return v;
	};
	switch (name) {
		case "sort": {
			const v = one();
			if (!isObject(v)) err(".sort() takes a document such as { createdAt: -1 }", seg.at);
			cursor.sort = v;
			return;
		}
		case "project":
		case "projection": {
			const v = one();
			if (!isObject(v)) err(`.${name}() takes a document such as { name: 1 }`, seg.at);
			cursor.projection = v;
			return;
		}
		case "limit":
			cursor.limit = Math.abs(count(one()));
			return;
		case "skip":
			cursor.skip = count(one());
			return;
		case "maxTimeMS":
			cursor.maxTimeMS = count(one());
			return;
		case "batchSize":
			count(one());
			return;
		case "hint":
			cursor.hint = one();
			return;
		case "collation": {
			const v = one();
			if (!isObject(v)) err(".collation() takes a document", seg.at);
			cursor.collation = v;
			return;
		}
		case "comment":
			cursor.comment = one();
			return;
		case "count":
			cursor.count = true;
			return;
	}
}

function needDoc(value: EJsonValue | undefined, what: string, at: number): EJsonObject {
	if (!isObject(value)) err(`${what} must be a document ({ … })`, at);
	return value;
}

function optDoc(value: EJsonValue | undefined, what: string, at: number): void {
	if (value !== undefined && value !== null && !isObject(value)) {
		err(`${what} must be a document ({ … })`, at);
	}
}

function arity(method: string, args: EJsonValue[], min: number, max: number, at: number): void {
	if (args.length < min || args.length > max) {
		const range = min === max ? `${min}` : `${min} to ${max}`;
		err(`${method}() takes ${range} argument${max === 1 ? "" : "s"}, got ${args.length}`, at);
	}
}

/** Check arity and shapes, and normalise the forms mongosh accepts. */
function normalizeArgs(method: CollectionMethod, args: EJsonValue[], at: number): EJsonValue[] {
	switch (method) {
		case "find":
		case "findOne":
			arity(method, args, 0, 3, at);
			optDoc(args[0], "The filter", at);
			optDoc(args[1], "The projection", at);
			optDoc(args[2], "The options", at);
			return [args[0] ?? {}, ...args.slice(1)];
		case "countDocuments":
			arity(method, args, 0, 2, at);
			optDoc(args[0], "The filter", at);
			optDoc(args[1], "The options", at);
			return [args[0] ?? {}, ...args.slice(1)];
		case "estimatedDocumentCount":
			arity(method, args, 0, 1, at);
			optDoc(args[0], "The options", at);
			return args;
		case "distinct":
			arity(method, args, 1, 3, at);
			if (typeof args[0] !== "string")
				err('distinct() takes the field name first, e.g. distinct("status")', at);
			optDoc(args[1], "The filter", at);
			optDoc(args[2], "The options", at);
			return args;
		case "aggregate": {
			// mongosh accepts both aggregate([stages], options) and aggregate(stage, stage, …).
			if (args.length === 0) return [[]];
			if (Array.isArray(args[0])) {
				arity(method, args, 1, 2, at);
				for (const stage of args[0]) needDoc(stage, "Each pipeline stage", at);
				optDoc(args[1], "The options", at);
				return args;
			}
			for (const stage of args) needDoc(stage, "Each pipeline stage", at);
			return [args];
		}
		case "insertOne":
			arity(method, args, 1, 2, at);
			needDoc(args[0], "The document", at);
			optDoc(args[1], "The options", at);
			return args;
		case "insertMany":
			arity(method, args, 1, 2, at);
			if (!Array.isArray(args[0])) err("insertMany() takes an array of documents", at);
			if (args[0].length === 0) err("insertMany() needs at least one document", at);
			for (const doc of args[0]) needDoc(doc, "Each document", at);
			optDoc(args[1], "The options", at);
			return args;
		case "updateOne":
		case "updateMany": {
			arity(method, args, 2, 3, at);
			needDoc(args[0], "The filter", at);
			const update = args[1];
			if (Array.isArray(update)) {
				for (const stage of update) needDoc(stage, "Each update pipeline stage", at);
			} else {
				const doc = needDoc(update, "The update", at);
				const keys = Object.keys(doc);
				if (keys.length === 0)
					err("The update is empty. Use operators such as { $set: { … } }", at);
				if (!keys.every((k) => k.startsWith("$"))) {
					err(
						`The update must use operators such as { $set: { … } }. To replace the whole document, use replaceOne().`,
						at,
					);
				}
			}
			optDoc(args[2], "The options", at);
			return args;
		}
		case "replaceOne": {
			arity(method, args, 2, 3, at);
			needDoc(args[0], "The filter", at);
			const doc = needDoc(args[1], "The replacement", at);
			if (Object.keys(doc).some((k) => k.startsWith("$"))) {
				err(
					"The replacement cannot contain update operators. Use updateOne() for $set and friends.",
					at,
				);
			}
			optDoc(args[2], "The options", at);
			return args;
		}
		case "deleteOne":
		case "deleteMany":
			arity(method, args, 1, 2, at);
			needDoc(args[0], "The filter", at);
			optDoc(args[1], "The options", at);
			return args;
		case "createIndex": {
			arity(method, args, 1, 2, at);
			const keys = needDoc(args[0], "The index keys", at);
			if (Object.keys(keys).length === 0) err("The index needs at least one field", at);
			optDoc(args[1], "The options", at);
			return args;
		}
		case "dropIndex":
			arity(method, args, 1, 1, at);
			if (typeof args[0] !== "string" && !isObject(args[0])) {
				err("dropIndex() takes an index name or its key document", at);
			}
			return args;
		case "getIndexes":
		case "drop":
			arity(method, args, 0, 0, at);
			return args;
	}
}

function validateDbArgs(method: DbMethod, args: EJsonValue[], at: number): void {
	switch (method) {
		case "createCollection":
			arity(method, args, 1, 2, at);
			if (typeof args[0] !== "string" || !args[0]) {
				err("createCollection() takes the collection name as a string", at);
			}
			optDoc(args[1], "The options", at);
			return;
		case "getCollectionInfos":
			arity(method, args, 0, 2, at);
			optDoc(args[0], "The filter", at);
			return;
		case "stats":
			arity(method, args, 0, 1, at);
			return;
		default:
			arity(method, args, 0, 0, at);
	}
}

/** True for a filter that matches every document: missing, or `{}`. */
export function isEmptyFilter(value: EJsonValue | undefined): boolean {
	return (
		value === undefined || value === null || (isObject(value) && Object.keys(value).length === 0)
	);
}

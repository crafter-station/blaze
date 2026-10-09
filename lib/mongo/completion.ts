import { COLLECTION_METHODS, CURSOR_METHODS, DB_METHODS } from "./shell";

/**
 * Completion for the Mongo shell: collection names, methods and `$` operators, chosen by
 * where the cursor is. Pure — the editor supplies the text, the cursor and what it knows
 * about the database, and renders whatever comes back.
 */

export type SuggestionKind = "keyword" | "collection" | "method" | "operator" | "stage" | "field";

export interface Suggestion {
	label: string;
	kind: SuggestionKind;
	/** Text inserted in place of the typed word. Defaults to `label`. */
	apply?: string;
	detail?: string;
}

export interface CompletionResult {
	/** Offset where the replaced word starts. */
	from: number;
	options: Suggestion[];
}

export interface CompletionContext {
	collections: string[];
	/** Known field paths per collection, from a sample. */
	fields?: Record<string, string[]>;
}

const METHOD_SIGNATURES: Record<string, string> = {
	find: "(filter?, projection?)",
	findOne: "(filter?, projection?)",
	aggregate: "([stages])",
	countDocuments: "(filter?)",
	estimatedDocumentCount: "()",
	distinct: '("field", filter?)',
	insertOne: "(document)",
	insertMany: "([documents])",
	updateOne: "(filter, update)",
	updateMany: "(filter, update)",
	replaceOne: "(filter, replacement)",
	deleteOne: "(filter)",
	deleteMany: "(filter)",
	createIndex: "(keys, options?)",
	dropIndex: '("name")',
	getIndexes: "()",
	drop: "()",
	getCollectionNames: "()",
	getCollectionInfos: "(filter?)",
	createCollection: '("name", options?)',
	stats: "()",
	dropDatabase: "()",
	runCommand: "({ command })",
	getName: "()",
	getCollection: '("name")',
	sort: "({ field: 1 })",
	limit: "(n)",
	skip: "(n)",
	project: "({ field: 1 })",
	projection: "({ field: 1 })",
	count: "()",
	toArray: "()",
	pretty: "()",
	batchSize: "(n)",
	hint: "(index)",
	maxTimeMS: "(ms)",
	collation: "({ locale })",
	comment: "(text)",
};

export const QUERY_OPERATORS = [
	"$eq",
	"$ne",
	"$gt",
	"$gte",
	"$lt",
	"$lte",
	"$in",
	"$nin",
	"$and",
	"$or",
	"$nor",
	"$not",
	"$exists",
	"$type",
	"$regex",
	"$options",
	"$elemMatch",
	"$size",
	"$all",
	"$expr",
	"$where",
	"$text",
	"$search",
	"$mod",
	"$jsonSchema",
	"$near",
	"$nearSphere",
	"$geoWithin",
	"$geoIntersects",
	"$comment",
];

export const UPDATE_OPERATORS = [
	"$set",
	"$unset",
	"$inc",
	"$mul",
	"$rename",
	"$min",
	"$max",
	"$currentDate",
	"$setOnInsert",
	"$push",
	"$pull",
	"$pullAll",
	"$addToSet",
	"$pop",
	"$each",
	"$position",
	"$slice",
	"$sort",
];

export const PIPELINE_STAGES = [
	"$match",
	"$project",
	"$group",
	"$sort",
	"$limit",
	"$skip",
	"$unwind",
	"$lookup",
	"$addFields",
	"$set",
	"$unset",
	"$count",
	"$facet",
	"$bucket",
	"$bucketAuto",
	"$sortByCount",
	"$replaceRoot",
	"$replaceWith",
	"$sample",
	"$unionWith",
	"$graphLookup",
	"$setWindowFields",
	"$densify",
	"$fill",
	"$geoNear",
	"$redact",
	"$documents",
	"$out",
	"$merge",
];

export const EXPRESSION_OPERATORS = [
	"$sum",
	"$avg",
	"$min",
	"$max",
	"$first",
	"$last",
	"$push",
	"$addToSet",
	"$count",
	"$concat",
	"$toUpper",
	"$toLower",
	"$substrCP",
	"$split",
	"$trim",
	"$regexMatch",
	"$dateToString",
	"$dateTrunc",
	"$dateDiff",
	"$year",
	"$month",
	"$dayOfMonth",
	"$cond",
	"$ifNull",
	"$switch",
	"$eq",
	"$ne",
	"$gt",
	"$gte",
	"$lt",
	"$lte",
	"$and",
	"$or",
	"$not",
	"$in",
	"$size",
	"$arrayElemAt",
	"$filter",
	"$map",
	"$reduce",
	"$add",
	"$subtract",
	"$multiply",
	"$divide",
	"$round",
	"$toString",
	"$toInt",
	"$toDouble",
	"$toDate",
	"$objectToArray",
	"$mergeObjects",
	"$literal",
	"$let",
];

interface Frame {
	ch: "(" | "{" | "[";
	/** For a call: the method name in front of the parenthesis. */
	method?: string;
	/** For a call: which argument the scan is in. */
	arg: number;
}

/** Bracket frames open at the end of `text`, ignoring strings and comments. */
function openFrames(text: string): Frame[] | null {
	const stack: Frame[] = [];
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === '"' || c === "'" || c === "`") {
			const q = c;
			i++;
			while (i < text.length && text[i] !== q) i += text[i] === "\\" ? 2 : 1;
			if (i >= text.length) return null; // inside a string: nothing to complete
			i++;
			continue;
		}
		if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			if (end === -1) return null;
			i = end + 2;
			continue;
		}
		if (c === "(") {
			const name = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(0, i));
			stack.push({ ch: "(", method: name?.[1], arg: 0 });
		} else if (c === "{" || c === "[") {
			stack.push({ ch: c, arg: 0 });
		} else if (c === ")" || c === "}" || c === "]") {
			stack.pop();
		} else if (c === ",") {
			const top = stack[stack.length - 1];
			if (top) top.arg++;
		}
		i++;
	}
	return stack;
}

/** The collection named by the statement, if it has got that far. */
export function collectionInStatement(text: string): string | null {
	const m =
		/\bdb\s*\.\s*getCollection\(\s*(["'])(.+?)\1\s*\)/.exec(text) ??
		/\bdb\s*\[\s*(["'])(.+?)\1\s*\]/.exec(text) ??
		/\bdb\s*\.\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*?)\s*\.\s*[A-Za-z_$][\w$]*\s*\(/.exec(
			text,
		);
	if (!m) return null;
	return m[2] ?? m[1];
}

function rank(options: Suggestion[], word: string): Suggestion[] {
	const w = word.toLowerCase();
	const starts = options.filter((o) => o.label.toLowerCase().startsWith(w));
	const contains = options.filter(
		(o) =>
			!o.label.toLowerCase().startsWith(w) && w.length > 1 && o.label.toLowerCase().includes(w),
	);
	const seen = new Set<string>();
	return [...starts, ...contains].filter((o) => {
		const key = `${o.kind}:${o.label}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function methods(names: readonly string[]): Suggestion[] {
	return names.map((name) => ({
		label: name,
		kind: "method" as const,
		apply: `${name}(`,
		detail: METHOD_SIGNATURES[name],
	}));
}

function operators(names: string[], kind: "operator" | "stage", detail: string): Suggestion[] {
	return names.map((label) => ({ label, kind, detail }));
}

const SIMPLE_NAME = /^[A-Za-z_$][\w$]*$/;

export function complete(
	text: string,
	cursor: number,
	context: CompletionContext,
): CompletionResult | null {
	const before = text.slice(0, cursor);
	const word = /[A-Za-z0-9_$]*$/.exec(before)?.[0] ?? "";
	const from = cursor - word.length;
	const head = before.slice(0, from);

	const frames = openFrames(head);
	if (frames === null) return null;

	// Statement start.
	if (head.trim() === "" && frames.length === 0) {
		return {
			from,
			options: rank(
				[
					{ label: "db", kind: "keyword", detail: "this database" },
					{ label: "show collections", kind: "keyword" },
					{ label: "show dbs", kind: "keyword" },
				],
				word,
			),
		};
	}

	if (head.endsWith(".")) {
		const left = head.slice(0, -1);
		// db.|
		if (/(^|[^\w$.\])])db\s*$/.test(left)) {
			const collections: Suggestion[] = context.collections.map((name) => ({
				label: name,
				kind: "collection",
				apply: SIMPLE_NAME.test(name) ? name : `getCollection(${JSON.stringify(name)})`,
				detail: "collection",
			}));
			return {
				from,
				options: rank([...collections, ...methods([...DB_METHODS, "getCollection"])], word),
			};
		}
		// db.orders.| / db.getCollection("x").| / db["x"].|
		if (
			/(^|[^\w$.])db\s*\.\s*[A-Za-z_$][\w$]*(\s*\.\s*[A-Za-z_$][\w$]*)*\s*$/.test(left) ||
			/(^|[^\w$.])db\s*\.\s*getCollection\(\s*(["']).*?\2\s*\)\s*$/.test(left) ||
			/(^|[^\w$.])db\s*\[\s*(["']).*?\2\s*\]\s*$/.test(left)
		) {
			return { from, options: rank(methods(COLLECTION_METHODS), word) };
		}
		// db.orders.find(…).|
		if (left.trimEnd().endsWith(")") && frames.length === 0) {
			if (/\.\s*find\s*\(/.test(left))
				return { from, options: rank(methods(CURSOR_METHODS), word) };
			if (/\.\s*aggregate\s*\(/.test(left)) {
				return { from, options: rank(methods(["toArray", "pretty"]), word) };
			}
		}
		return null;
	}

	const top = frames[frames.length - 1];
	if (top?.ch !== "{") return null;

	// Key position: right after `{` or `,` inside a document.
	// (Inside a quoted key the scan above already returned: strings are not completed.)
	const lastChar = head.trimEnd().slice(-1);
	if (lastChar !== "{" && lastChar !== ",") return null;

	const call = [...frames].reverse().find((f) => f.ch === "(");
	const method = call?.method ?? "";
	const callIndex = call ? frames.lastIndexOf(call) : -1;
	const depthInCall = frames.length - 1 - callIndex;

	if (word.startsWith("$")) {
		let options: Suggestion[];
		if (method === "aggregate") {
			const parent = frames[frames.length - 2];
			const isStage =
				(parent?.ch === "[" && frames[frames.length - 3] === call && depthInCall === 2) ||
				(parent === call && depthInCall === 1);
			options = isStage
				? operators(PIPELINE_STAGES, "stage", "stage")
				: [
						...operators(EXPRESSION_OPERATORS, "operator", "expression"),
						...operators(QUERY_OPERATORS, "operator", "query"),
					];
		} else if ((method === "updateOne" || method === "updateMany") && call?.arg === 1) {
			options =
				depthInCall === 1
					? operators(UPDATE_OPERATORS, "operator", "update")
					: operators(["$each", "$position", "$slice", "$sort", "$in"], "operator", "modifier");
		} else if (method === "runCommand" || (frames[0]?.ch === "{" && !call)) {
			options = [];
		} else {
			options = operators(QUERY_OPERATORS, "operator", "query");
		}
		return { from, options: rank(options, word) };
	}

	// A field name: offer what the sample saw in this collection.
	const collection = collectionInStatement(text);
	const fields = collection ? (context.fields?.[collection] ?? []) : [];
	if (fields.length === 0) return null;
	const options: Suggestion[] = fields.map((path) => ({
		label: path,
		kind: "field",
		apply: SIMPLE_NAME.test(path) ? path : JSON.stringify(path),
		detail: "field",
	}));
	return { from, options: rank(options, word) };
}

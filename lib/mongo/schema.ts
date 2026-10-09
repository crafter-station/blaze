import { bsonTypeOf, type EJsonValue, isObject } from "./literal";

/**
 * The shape of a collection, inferred from a handful of documents: field paths and the
 * BSON types seen at each. **Keys and types only, never values** — this feeds the Ask AI
 * context, so nothing a tenant stored ever leaves for a model provider, only the outline.
 * It also feeds the shell's field-name completion and the browser's table columns.
 */

export interface FieldShape {
	/** Dot path, e.g. `address.city`. Array elements are described under the array's path. */
	path: string;
	/** BSON type names in the order first seen, e.g. `["string", "null"]`. */
	types: string[];
	/** How many sampled documents had this path. */
	seen: number;
}

export interface CollectionShape {
	name: string;
	sampled: number;
	fields: FieldShape[];
}

/** Documents sampled per collection. */
export const SAMPLE_SIZE = 20;
const MAX_DEPTH = 4;
const MAX_FIELDS = 120;

function isTypeWrapper(value: EJsonValue): boolean {
	return isObject(value) && bsonTypeOf(value) !== "object";
}

export function inferShape(name: string, docs: EJsonValue[]): CollectionShape {
	const fields = new Map<string, { types: string[]; seen: Set<number> }>();

	const note = (path: string, type: string, doc: number) => {
		let field = fields.get(path);
		if (!field) {
			if (fields.size >= MAX_FIELDS) return;
			field = { types: [], seen: new Set() };
			fields.set(path, field);
		}
		if (!field.types.includes(type)) field.types.push(type);
		field.seen.add(doc);
	};

	const walk = (value: EJsonValue, path: string, depth: number, doc: number) => {
		if (isObject(value) && !isTypeWrapper(value)) {
			if (path) note(path, "object", doc);
			if (depth >= MAX_DEPTH) return;
			for (const [key, child] of Object.entries(value)) {
				walk(child, path ? `${path}.${key}` : key, depth + 1, doc);
			}
			return;
		}
		if (Array.isArray(value)) {
			const inner = [...new Set(value.slice(0, 50).map((v) => bsonTypeOf(v)))];
			note(path, inner.length ? `array<${inner.join("|")}>` : "array", doc);
			if (depth >= MAX_DEPTH) return;
			for (const element of value.slice(0, 20)) {
				if (isObject(element) && !isTypeWrapper(element)) {
					for (const [key, child] of Object.entries(element)) {
						walk(child, `${path}.${key}`, depth + 1, doc);
					}
				}
			}
			return;
		}
		note(path, bsonTypeOf(value), doc);
	};

	for (const [i, doc] of docs.entries()) walk(doc, "", 0, i);
	return {
		name,
		sampled: docs.length,
		fields: [...fields.entries()].map(([path, f]) => ({ path, types: f.types, seen: f.seen.size })),
	};
}

/** Compact text for a model prompt: one line per field, with the share of documents that had it. */
export function describeShapes(shapes: CollectionShape[]): string {
	return shapes
		.map((shape) => {
			const lines = shape.fields.map((f) => {
				const optional = f.seen < shape.sampled ? ` (in ${f.seen}/${shape.sampled})` : "";
				return `  ${f.path}: ${f.types.join(" | ")}${optional}`;
			});
			const header = `${shape.name} (sampled ${shape.sampled} document${shape.sampled === 1 ? "" : "s"})`;
			return lines.length ? `${header}\n${lines.join("\n")}` : `${header}\n  (empty)`;
		})
		.join("\n\n");
}

/** Column order for a page of documents: `_id` first, then keys in order of first appearance. */
export function topLevelColumns(docs: EJsonValue[], limit = 60): string[] {
	const seen = new Set<string>();
	const order: string[] = [];
	for (const doc of docs) {
		if (!isObject(doc)) continue;
		for (const key of Object.keys(doc)) {
			if (!seen.has(key)) {
				seen.add(key);
				order.push(key);
			}
		}
	}
	const rest = order.filter((k) => k !== "_id");
	return [...(seen.has("_id") ? ["_id"] : []), ...rest].slice(0, limit);
}

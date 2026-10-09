import { BSON } from "mongodb";
import {
	type EJsonObject,
	type EJsonValue,
	isObject,
	LiteralParseError,
	parseLiteral,
} from "./literal";

/**
 * The boundary between BSON (what the driver speaks) and the Extended JSON the browser
 * renders and edits.
 *
 * Outgoing values use a **display** dialect of Extended JSON v2: canonical where a type
 * would otherwise be lost (`$numberLong`, `$numberDecimal`, an integral double), relaxed
 * where it would only be noise (an int32 is just a number, a double with a fraction is just
 * a number, a date is an ISO string inside `$date`). Every value it produces round-trips
 * through `toShell` and `parseLiteral` back to the same BSON type, which is what makes
 * "edit this document" safe.
 */

/** Response budget for documents sent to the browser in one call. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function tidy(value: EJsonValue): EJsonValue {
	if (Array.isArray(value)) return value.map(tidy);
	if (!isObject(value)) return value;
	const keys = Object.keys(value);
	if (keys.length === 1) {
		const [k] = keys;
		const v = value[k];
		if (k === "$numberInt" && typeof v === "string") return Number(v);
		if (k === "$numberDouble" && typeof v === "string") {
			const n = Number(v);
			// Keep the wrapper only where a bare number would read back as another type.
			return Number.isFinite(n) && !Number.isInteger(n) ? n : value;
		}
		if (k === "$date" && isObject(v) && typeof v.$numberLong === "string") {
			const d = new Date(Number(v.$numberLong));
			return Number.isNaN(d.getTime()) ? value : { $date: d.toISOString() };
		}
	}
	const out: EJsonObject = {};
	for (const [k, v] of Object.entries(value)) out[k] = tidy(v);
	return out;
}

/** A BSON value (document, array, scalar) as display Extended JSON. */
export function toDisplay(value: unknown): EJsonValue {
	const canonical = BSON.EJSON.serialize(value, { relaxed: false }) as EJsonValue;
	return tidy(canonical);
}

/** Extended JSON (from `parseLiteral`) to the BSON values the driver sends. */
export function fromEJson<T = unknown>(value: EJsonValue): T {
	if (value === null || typeof value !== "object") return value as T;
	return BSON.EJSON.deserialize(value as object, { relaxed: false }) as T;
}

/** Parse shell-syntax text into a BSON document, or throw a positioned parse error. */
export function parseBsonDocument(text: string, what: string): BSON.Document {
	const source = text.trim();
	if (!source) return {};
	const value = parseLiteral(source);
	if (!isObject(value)) throw new LiteralParseError(`${what} must be a document ({ … })`, 0);
	return fromEJson<BSON.Document>(value);
}

/**
 * Convert documents to display form until the byte budget runs out.
 * Returns how many fit, so the caller can say the rest were held back.
 */
export function displayDocuments(
	docs: unknown[],
	budget = MAX_RESPONSE_BYTES,
): { docs: EJsonValue[]; bytes: number; clipped: boolean } {
	const out: EJsonValue[] = [];
	let bytes = 0;
	for (const doc of docs) {
		const shown = toDisplay(doc);
		const size = JSON.stringify(shown).length;
		if (bytes + size > budget && out.length > 0) return { docs: out, bytes, clipped: true };
		out.push(shown);
		bytes += size;
	}
	return { docs: out, bytes, clipped: false };
}

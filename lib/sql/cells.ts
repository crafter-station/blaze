import type { ResultColumn } from "./types";

/**
 * How a result column should be displayed and sorted, derived from the engine's type name
 * (`int4`, `DECIMAL`, `jsonb`, `TEXT`) and, when the driver gave none, from the values.
 */

export type CellKind = "number" | "boolean" | "json" | "date" | "binary" | "text";

export function columnKind(column: ResultColumn, sample: unknown[]): CellKind {
	const type = (column.type ?? "").toLowerCase();
	if (/^(date|time|timestamp|timestamptz|timetz|datetime|interval)/.test(type)) return "date";
	if (
		/^(int|smallint|bigint|tinyint|mediumint|integer|float|double|real|decimal|numeric|money|oid|year)/.test(
			type,
		)
	) {
		return "number";
	}
	if (type === "bool" || type === "boolean") return "boolean";
	if (type.startsWith("json") || type.endsWith("[]")) return "json";
	if (/bytea|blob|binary/.test(type)) return "binary";

	const present = sample.filter((v) => v !== null && v !== undefined);
	if (present.length > 0) {
		if (present.every((v) => typeof v === "number" || typeof v === "bigint")) return "number";
		if (present.every((v) => typeof v === "boolean")) return "boolean";
		if (present.every((v) => typeof v === "object")) return "json";
	}
	return "text";
}

/** Single-line preview for a grid cell. */
export function previewCell(value: unknown, max = 400): string {
	if (value === null || value === undefined) return "NULL";
	let text: string;
	if (typeof value === "string") text = value;
	else if (typeof value === "object") text = JSON.stringify(value);
	else text = String(value);
	text = text.replace(/\r?\n/g, " ↵ ");
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Full, readable form for the inspector: JSON pretty-printed, everything else verbatim. */
export function fullCell(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "object") return JSON.stringify(value, null, 2);
	if (typeof value === "string") {
		const trimmed = value.trim();
		// Many drivers return JSON columns as text (MariaDB, SQLite); show them structured.
		if (
			(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
			(trimmed.startsWith("[") && trimmed.endsWith("]"))
		) {
			try {
				return JSON.stringify(JSON.parse(trimmed), null, 2);
			} catch {
				return value;
			}
		}
		return value;
	}
	return String(value);
}

/** Nulls last; numbers (including numeric strings) numerically; everything else as text. */
export function compareCells(a: unknown, b: unknown, kind: CellKind): number {
	const aNull = a === null || a === undefined;
	const bNull = b === null || b === undefined;
	if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1;
	if (kind === "number") {
		const x = Number(a);
		const y = Number(b);
		if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y;
	}
	if (kind === "boolean") return Number(a) - Number(b);
	const x = typeof a === "object" ? JSON.stringify(a) : String(a);
	const y = typeof b === "object" ? JSON.stringify(b) : String(b);
	return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
}

/** A starting width that fits the header (name, type, menu) and typical values. */
export function initialWidth(column: ResultColumn, sample: unknown[]): number {
	const type = Math.min((column.type ?? "").length, 14);
	const header = column.name.length * 7.2 + (type ? type * 6.2 + 6 : 0) + 54;
	const values = sample.slice(0, 60).map((v) => Math.min(previewCell(v, 80).length, 60));
	values.sort((x, y) => x - y);
	const typical = values.length ? values[Math.floor(values.length * 0.85)] : 4;
	const body = typical * 7.4 + 28;
	return Math.round(Math.min(Math.max(header, body, 84), 380));
}

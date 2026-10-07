import type { ResultColumn } from "./types";

/**
 * Text and file forms of a result set: CSV and JSON for export, TSV and JSON for the
 * clipboard. TSV is what spreadsheets paste natively, so a copied selection lands in
 * cells rather than in one column.
 *
 * NULL becomes an empty field in CSV/TSV (there is no NULL in either format, and an empty
 * field is what every spreadsheet and `COPY … CSV` reads back as NULL) and `null` in JSON.
 * Structured values (JSON columns, arrays) are serialised as JSON text.
 */

export function cellToText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	return JSON.stringify(value);
}

function escapeDelimited(text: string, delimiter: string): string {
	if (
		text.includes('"') ||
		text.includes(delimiter) ||
		text.includes("\n") ||
		text.includes("\r")
	) {
		return `"${text.replace(/"/g, '""')}"`;
	}
	return text;
}

function delimited(
	columns: string[] | null,
	rows: unknown[][],
	delimiter: string,
	newline: string,
): string {
	const lines: string[] = [];
	if (columns) lines.push(columns.map((c) => escapeDelimited(c, delimiter)).join(delimiter));
	for (const row of rows) {
		lines.push(row.map((cell) => escapeDelimited(cellToText(cell), delimiter)).join(delimiter));
	}
	return lines.join(newline);
}

/** RFC 4180 CSV with a header row and CRLF line endings. */
export function toCsv(columns: ResultColumn[], rows: unknown[][]): string {
	return `${delimited(
		columns.map((c) => c.name),
		rows,
		",",
		"\r\n",
	)}\r\n`;
}

/** Tab-separated, for the clipboard. `header` adds the column names as the first line. */
export function toTsv(columns: ResultColumn[] | null, rows: unknown[][]): string {
	return delimited(columns ? columns.map((c) => c.name) : null, rows, "\t", "\n");
}

/**
 * Column names made unique for use as object keys: a join can legally return two
 * columns called `id`, and a JSON object cannot hold both.
 */
export function uniqueKeys(columns: ResultColumn[]): string[] {
	const seen = new Map<string, number>();
	return columns.map((column) => {
		const count = (seen.get(column.name) ?? 0) + 1;
		seen.set(column.name, count);
		return count === 1 ? column.name : `${column.name}_${count}`;
	});
}

export function toJsonRows(columns: ResultColumn[], rows: unknown[][]): Record<string, unknown>[] {
	const keys = uniqueKeys(columns);
	return rows.map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i] ?? null])));
}

export function toJson(columns: ResultColumn[], rows: unknown[][]): string {
	return JSON.stringify(toJsonRows(columns, rows), null, 2);
}

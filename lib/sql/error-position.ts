import { lex } from "./lexer";
import type { SqlEngine } from "./types";

/**
 * Where in a statement an engine error points, so the editor can underline it.
 *
 * Postgres reports an exact character offset. MySQL and MariaDB quote the text "near" the
 * failure and give a line. SQLite/libSQL quote the offending token, name the missing table
 * or column, or (sqld's own parser) give a `(line, column)`. Anything else returns null
 * and the console shows the message without a marker rather than guessing.
 */

export interface ErrorSpan {
	/** Offsets relative to the start of the statement text. */
	from: number;
	to: number;
}

export interface EngineError {
	message: string;
	/** Postgres: 1-based character offset. */
	position?: number;
}

export function locateError(
	engine: SqlEngine,
	statement: string,
	error: EngineError,
): ErrorSpan | null {
	if (!statement) return null;

	if (engine === "postgres") {
		if (error.position && error.position > 0) {
			// node-postgres counts characters of the statement as sent, 1-based.
			return tokenAt(engine, statement, Math.min(error.position - 1, statement.length - 1));
		}
		return identifierSpan(
			engine,
			statement,
			quotedName(error.message, /(?:relation|column|function|table|schema|type) "([^"]+)"/i),
		);
	}

	if (engine === "mysql" || engine === "mariadb") {
		const near = /near '([\s\S]*)' at line (\d+)\s*$/.exec(error.message);
		if (near) {
			const [, text, lineText] = near;
			const lineStart = offsetOfLine(statement, Number(lineText));
			if (text === "") {
				const end = statement.trimEnd().length;
				return { from: Math.max(0, end - 1), to: end };
			}
			// The quoted text is the rest of the statement, cut at ~80 characters.
			for (const probe of [text, text.slice(0, 40), text.slice(0, 12)]) {
				if (!probe) continue;
				let at = statement.indexOf(probe, lineStart);
				if (at === -1) at = statement.indexOf(probe);
				if (at !== -1) return tokenAt(engine, statement, at);
			}
			return null;
		}
		const name =
			quotedName(error.message, /Unknown column '([^']+)'/i) ??
			quotedName(error.message, /Table '(?:[^'.]+\.)?([^']+)' doesn't exist/i) ??
			quotedName(error.message, /FUNCTION (?:[^ .]+\.)?(\S+) does not exist/i);
		return identifierSpan(engine, statement, name);
	}

	// libSQL / SQLite. sqld's own parser reports `(at offset N)`, `around L1:13: \`FRM\``
	// or `near FROM, "None": syntax error at (2, 7)`, where the column is the end of the
	// offending token; SQLite itself says `near "FRM": syntax error`.
	const offset = /\(at offset (\d+)\)/.exec(error.message);
	if (offset && Number(offset[1]) < statement.length) {
		return tokenAt(engine, statement, Number(offset[1]));
	}
	const lineCol =
		/around L(\d+):(\d+)/.exec(error.message) ?? /at \((\d+), (\d+)\)/.exec(error.message);
	const token =
		/around L\d+:\d+: `([^`]+)`/.exec(error.message)?.[1] ??
		/near ([^\s,"]+), /.exec(error.message)?.[1] ??
		/near "([^"]+)"/.exec(error.message)?.[1];
	if (token) {
		const end = lineCol
			? offsetOfLine(statement, Number(lineCol[1])) + Number(lineCol[2])
			: statement.length;
		const span = lastTokenBefore(engine, statement, token, end);
		if (span) return span;
	}
	if (lineCol) {
		const at = offsetOfLine(statement, Number(lineCol[1])) + Math.max(0, Number(lineCol[2]) - 1);
		if (at < statement.length) return tokenAt(engine, statement, at);
	}
	const name =
		quotedName(error.message, /no such (?:table|column|function): (\S+)/i) ??
		quotedName(error.message, /no such (?:table|column): ([^\s,]+)/i);
	return identifierSpan(engine, statement, name);
}

function quotedName(message: string, pattern: RegExp): string | null {
	const match = pattern.exec(message);
	return match?.[1] ?? null;
}

function offsetOfLine(text: string, line: number): number {
	let offset = 0;
	for (let current = 1; current < line; current++) {
		const next = text.indexOf("\n", offset);
		if (next === -1) return offset;
		offset = next + 1;
	}
	return offset;
}

/** The token covering `offset`, skipping forward over whitespace. */
function tokenAt(engine: SqlEngine, statement: string, offset: number): ErrorSpan {
	for (const token of lex(statement, engine)) {
		if (token.end <= offset) continue;
		if (token.type === "space") continue;
		return { from: Math.max(token.start, offset), to: token.end };
	}
	return { from: offset, to: Math.min(statement.length, offset + 1) };
}

/**
 * The last code token with exactly this text that starts before `before`, falling back
 * to the first one anywhere. Matches punctuation too, which is how SQLite's `near ","`
 * refers to it.
 */
function lastTokenBefore(
	engine: SqlEngine,
	statement: string,
	text: string,
	before: number,
): ErrorSpan | null {
	let best: ErrorSpan | null = null;
	let first: ErrorSpan | null = null;
	for (const token of lex(statement, engine)) {
		if (token.type === "space" || token.type === "comment") continue;
		if (token.text.toLowerCase() !== text.toLowerCase()) continue;
		const span = { from: token.start, to: token.end };
		first ??= span;
		if (token.start < before) best = span;
	}
	return best ?? first;
}

/** First code token matching a (possibly qualified) name, quoted or not. */
function identifierSpan(
	engine: SqlEngine,
	statement: string,
	name: string | null,
): ErrorSpan | null {
	if (!name) return null;
	const last = name.split(".").pop() ?? name;
	const wanted = [name, last].map((n) => n.toLowerCase());
	for (const token of lex(statement, engine)) {
		if (token.type === "space" || token.type === "comment" || token.type === "string") continue;
		const text = token.type === "quoted" ? token.text.slice(1, -1) : token.text;
		if (wanted.includes(text.toLowerCase())) return { from: token.start, to: token.end };
	}
	return null;
}

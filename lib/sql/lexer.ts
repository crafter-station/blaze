import { DIALECTS } from "./dialect";
import type { SqlEngine } from "./types";

/**
 * A deliberately small SQL lexer: just enough to know, for any character, whether it is
 * inside a string, a quoted identifier or a comment. That single fact is what statement
 * splitting, "statement under cursor" and destructive-statement detection all hinge on,
 * and getting it wrong is how a semicolon inside `'a;b'` ends up splitting a query.
 *
 * It does not parse SQL and never needs to.
 */

export type TokenType = "word" | "quoted" | "string" | "comment" | "space" | "punct";

export interface Token {
	type: TokenType;
	/** Raw source text of the token. */
	text: string;
	start: number;
	end: number;
}

const WORD_START = /[A-Za-z_À-￿0-9]/;
const WORD_PART = /[A-Za-z0-9_$À-￿]/;

export function lex(sql: string, engine: SqlEngine): Token[] {
	const dialect = DIALECTS[engine];
	const tokens: Token[] = [];
	const n = sql.length;
	let i = 0;

	const push = (type: TokenType, start: number, end: number) =>
		tokens.push({ type, text: sql.slice(start, end), start, end });

	while (i < n) {
		const ch = sql[i];
		const next = sql[i + 1];
		const start = i;

		// Whitespace
		if (/\s/.test(ch)) {
			while (i < n && /\s/.test(sql[i])) i++;
			push("space", start, i);
			continue;
		}

		// Line comments: `--` everywhere, `#` in MySQL/MariaDB.
		if ((ch === "-" && next === "-") || (ch === "#" && dialect.hashComments)) {
			while (i < n && sql[i] !== "\n") i++;
			push("comment", start, i);
			continue;
		}

		// Block comments. Postgres nests them; the others end at the first `*/`.
		if (ch === "/" && next === "*") {
			let depth = 1;
			i += 2;
			while (i < n && depth > 0) {
				if (sql[i] === "*" && sql[i + 1] === "/") {
					depth--;
					i += 2;
				} else if (engine === "postgres" && sql[i] === "/" && sql[i + 1] === "*") {
					depth++;
					i += 2;
				} else i++;
			}
			push("comment", start, i);
			continue;
		}

		// Postgres dollar quoting: $$ … $$ or $tag$ … $tag$. `$1` is a parameter, not a tag.
		if (ch === "$" && dialect.dollarQuotes) {
			const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
			const prev = sql[i - 1];
			if (match && !(prev && WORD_PART.test(prev))) {
				const tag = match[0];
				const close = sql.indexOf(tag, i + tag.length);
				i = close === -1 ? n : close + tag.length;
				push("string", start, i);
				continue;
			}
		}

		// String literals. Postgres E'' strings and MySQL strings honour backslash escapes.
		if (ch === "'") {
			const prev = sql[i - 1];
			const escapeString =
				engine === "postgres" &&
				(prev === "E" || prev === "e") &&
				!(sql[i - 2] && WORD_PART.test(sql[i - 2]));
			i = scanQuoted(sql, i, "'", dialect.backslashEscapes || escapeString);
			// Glue an E/N/X/B prefix onto the string so it is not read as a separate word.
			const last = tokens[tokens.length - 1];
			if (last?.type === "word" && last.end === start && /^[EeNnXxBb]$/.test(last.text)) {
				tokens.pop();
				push("string", last.start, i);
			} else push("string", start, i);
			continue;
		}

		// Double quotes: identifiers in Postgres/SQLite, strings in default-mode MySQL.
		if (ch === '"') {
			i = scanQuoted(sql, i, '"', dialect.backslashEscapes);
			push(dialect.quote === '"' ? "quoted" : "string", start, i);
			continue;
		}

		// Backticks: identifiers in MySQL, MariaDB and SQLite.
		if (ch === "`" && engine !== "postgres") {
			i = scanQuoted(sql, i, "`", false);
			push("quoted", start, i);
			continue;
		}

		// SQLite also accepts [bracketed] identifiers.
		if (ch === "[" && engine === "libsql") {
			const close = sql.indexOf("]", i + 1);
			i = close === -1 ? n : close + 1;
			push("quoted", start, i);
			continue;
		}

		if (WORD_START.test(ch) || (ch === "$" && /[0-9]/.test(next ?? ""))) {
			i++;
			while (i < n && WORD_PART.test(sql[i])) i++;
			push("word", start, i);
			continue;
		}

		push("punct", start, i + 1);
		i++;
	}

	return tokens;
}

/** Index just past the closing quote, honouring doubled quotes and optional backslashes. */
function scanQuoted(sql: string, open: number, quote: string, backslash: boolean): number {
	let i = open + 1;
	while (i < sql.length) {
		const ch = sql[i];
		if (backslash && ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === quote) {
			if (sql[i + 1] === quote) {
				i += 2;
				continue;
			}
			return i + 1;
		}
		i++;
	}
	return sql.length;
}

/** Tokens that carry meaning: no whitespace, no comments. */
export function significant(tokens: Token[]): Token[] {
	return tokens.filter((t) => t.type !== "space" && t.type !== "comment");
}

import { lex, type Token } from "./lexer";
import type { SqlEngine } from "./types";

/**
 * Statement splitting and "statement under cursor".
 *
 * Splits on `;` outside strings, quoted identifiers, comments and dollar-quoted bodies,
 * and also outside `BEGIN … END` blocks of routine definitions (triggers in SQLite and
 * MySQL, procedures/functions/events in MySQL, `BEGIN ATOMIC` in Postgres), where the
 * semicolons belong to the body rather than ending the statement.
 */

export interface Statement {
	/** Statement text without surrounding whitespace or the terminating semicolon. */
	text: string;
	/** Offset of the first character of `text` in the source. */
	from: number;
	/** Offset just past the last character of `text`. */
	to: number;
	/** Offset just past the terminating `;`, or `to` when there is none. */
	end: number;
}

const ROUTINE_KINDS = new Set(["TRIGGER", "PROCEDURE", "FUNCTION", "EVENT"]);
const BLOCK_OPENERS = new Set(["BEGIN", "CASE", "IF", "LOOP", "WHILE", "REPEAT"]);

export function splitStatements(sql: string, engine: SqlEngine): Statement[] {
	const tokens = lex(sql, engine);
	const statements: Statement[] = [];

	let current: Token[] = [];
	let words: string[] = [];
	let routine = false;
	let depth = 0;
	let closing = false;

	const flush = (end: number) => {
		const meaningful = current.filter((t) => t.type !== "space");
		// A run of nothing but comments is not a statement.
		if (meaningful.some((t) => t.type !== "comment")) {
			const first = meaningful[0];
			const last = meaningful[meaningful.length - 1];
			statements.push({
				text: sql.slice(first.start, last.end),
				from: first.start,
				to: last.end,
				end: Math.max(end, last.end),
			});
		}
		current = [];
		words = [];
		routine = false;
		depth = 0;
		closing = false;
	};

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];

		if (token.type === "punct" && token.text === ";" && depth <= 0) {
			flush(token.end);
			continue;
		}

		current.push(token);
		if (token.type !== "word") continue;

		const word = token.text.toUpperCase();
		if (words.length < 8) {
			words.push(word);
			if (words[0] === "CREATE" && ROUTINE_KINDS.has(word)) routine = true;
		}
		if (!routine) continue;

		if (word === "END") {
			depth--;
			// `END IF` / `END LOOP` / `END CASE` close one block, not two: the keyword after
			// END must not be counted as an opener.
			closing = true;
			continue;
		}

		if (closing) {
			closing = false;
			if (BLOCK_OPENERS.has(word) && word !== "BEGIN") continue;
		}

		if (word === "BEGIN" || word === "CASE") {
			depth++;
		} else if (BLOCK_OPENERS.has(word) && startsStatement(tokens, index)) {
			// IF / WHILE / LOOP / REPEAT open a block only as a statement of their own; as
			// `IF(…)` the function or `IF EXISTS` the DDL clause they never start one.
			depth++;
		}
	}
	flush(sql.length);
	return statements;
}

/** Words after which a routine body starts a new statement. */
const STATEMENT_BOUNDARY = new Set([";", ":", "BEGIN", "THEN", "ELSE", "DO", "LOOP", "REPEAT"]);

function startsStatement(tokens: Token[], index: number): boolean {
	for (let i = index - 1; i >= 0; i--) {
		const token = tokens[i];
		if (token.type === "space" || token.type === "comment") continue;
		return STATEMENT_BOUNDARY.has(token.text.toUpperCase());
	}
	return false;
}

/**
 * The statement a cursor at `pos` means.
 *
 * Inside a statement (or on its terminating semicolon) that statement; in the whitespace
 * after one, the one just finished, which is what you mean when you type a query and
 * press Ctrl+Enter at the end of the line.
 */
export function statementAt(statements: Statement[], pos: number): Statement | null {
	if (statements.length === 0) return null;
	for (const statement of statements) {
		if (pos >= statement.from && pos <= statement.end) return statement;
	}
	let previous: Statement | null = null;
	for (const statement of statements) {
		if (statement.end <= pos) previous = statement;
	}
	return previous ?? statements[0];
}

/** Statements fully or partly inside `[from, to)`, re-split from the selected text. */
export function statementsInRange(
	sql: string,
	from: number,
	to: number,
	engine: SqlEngine,
): Statement[] {
	return splitStatements(sql.slice(from, to), engine).map((s) => ({
		text: s.text,
		from: s.from + from,
		to: s.to + from,
		end: s.end + from,
	}));
}

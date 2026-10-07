import { lex, significant, type Token } from "./lexer";
import type { SqlEngine } from "./types";

/**
 * Spots statements worth a second look before they run: DROP, TRUNCATE, ALTER … DROP,
 * and DELETE / UPDATE with no WHERE clause.
 *
 * This is a seatbelt, not a security boundary. It exists so a stray Ctrl+Enter does not
 * empty a table; it is trivially bypassed on purpose (wrap it in a function, write
 * `WHERE true`), and the tenant role's grants remain what actually limits a statement.
 */

export type DestructiveKind = "drop" | "truncate" | "delete-all" | "update-all";

export interface DestructiveFinding {
	kind: DestructiveKind;
	/** Short human label, e.g. "DROP TABLE" or "DELETE without WHERE". */
	label: string;
}

/** Words before UPDATE/DELETE that make it a clause rather than a statement. */
const CLAUSE_PREFIX = new Set(["FOR", "ON", "DO", "KEY", "BEFORE", "AFTER", "OF", "OR", "INSTEAD"]);

/** Words that end an UPDATE/DELETE's own clause list at the same nesting depth. */
const TERMINATORS = new Set(["RETURNING", "UNION", "EXCEPT", "INTERSECT"]);

export function detectDestructive(sql: string, engine: SqlEngine): DestructiveFinding | null {
	const tokens = significant(lex(sql, engine));
	if (tokens.length === 0) return null;

	const depths = depthsOf(tokens);
	const verbIndex = mainVerbIndex(tokens, depths);
	const verb = verbIndex === -1 ? "" : upper(tokens[verbIndex]);

	// Definitions only describe what will run later (a trigger body, a rule, a function),
	// so their DML is not executed now.
	if (verb === "CREATE") return null;

	if (verb === "DROP") {
		return { kind: "drop", label: `DROP ${objectWord(tokens, verbIndex)}`.trim() };
	}
	if (verb === "TRUNCATE") return { kind: "truncate", label: "TRUNCATE" };

	if (verb === "ALTER") {
		for (let i = verbIndex + 1; i < tokens.length; i++) {
			if (depths[i] === depths[verbIndex] && upper(tokens[i]) === "DROP") {
				return { kind: "drop", label: `ALTER … DROP ${objectWord(tokens, i)}`.trim() };
			}
		}
		return null;
	}

	// DELETE / UPDATE anywhere at statement level, including data-modifying CTEs.
	for (let i = 0; i < tokens.length; i++) {
		const word = upper(tokens[i]);
		if (word !== "DELETE" && word !== "UPDATE") continue;
		if (tokens[i].type !== "word") continue;
		const before = i > 0 ? upper(tokens[i - 1]) : "";
		if (CLAUSE_PREFIX.has(before)) continue;
		// `UPDATE` in a privilege list (GRANT UPDATE ON …) is not a statement either.
		if (verb === "GRANT" || verb === "REVOKE") continue;
		if (!hasWhere(tokens, depths, i)) {
			return word === "DELETE"
				? { kind: "delete-all", label: "DELETE without WHERE" }
				: { kind: "update-all", label: "UPDATE without WHERE" };
		}
	}
	return null;
}

function upper(token: Token | undefined): string {
	return token?.type === "word" ? token.text.toUpperCase() : "";
}

function depthsOf(tokens: Token[]): number[] {
	const depths: number[] = [];
	let depth = 0;
	for (const token of tokens) {
		if (token.text === ")") depth = Math.max(0, depth - 1);
		depths.push(depth);
		if (token.text === "(") depth++;
	}
	return depths;
}

/** Index of the statement's main verb, skipping a leading `WITH …` CTE list. */
function mainVerbIndex(tokens: Token[], depths: number[]): number {
	const first = upper(tokens[0]);
	if (first !== "WITH") return tokens[0].type === "word" ? 0 : -1;
	for (let i = 1; i < tokens.length; i++) {
		if (depths[i] !== 0) continue;
		const word = upper(tokens[i]);
		if (["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "VALUES", "TABLE"].includes(word)) {
			return i;
		}
	}
	return -1;
}

/** Whether the DELETE/UPDATE at `index` has its own WHERE at the same depth. */
function hasWhere(tokens: Token[], depths: number[], index: number): boolean {
	const depth = depths[index];
	for (let i = index + 1; i < tokens.length; i++) {
		if (depths[i] < depth) return false;
		if (depths[i] !== depth) continue;
		const word = upper(tokens[i]);
		if (word === "WHERE") return true;
		if (TERMINATORS.has(word)) return false;
		if (tokens[i].text === ";") return false;
	}
	return false;
}

/** The object kind after DROP, e.g. TABLE, SCHEMA, COLUMN. */
function objectWord(tokens: Token[], index: number): string {
	const next = upper(tokens[index + 1]);
	if (
		[
			"TABLE",
			"SCHEMA",
			"DATABASE",
			"VIEW",
			"INDEX",
			"COLUMN",
			"CONSTRAINT",
			"FUNCTION",
			"TRIGGER",
			"TYPE",
			"SEQUENCE",
			"MATERIALIZED",
			"PROCEDURE",
			"EXTENSION",
			"ROLE",
			"USER",
			"EVENT",
			"OWNED",
			"POLICY",
		].includes(next)
	) {
		return next === "MATERIALIZED" ? "MATERIALIZED VIEW" : next;
	}
	return "";
}

const READ_VERBS = new Set(["SELECT", "VALUES", "TABLE", "SHOW"]);
const WRITE_WORDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE", "INTO"]);

/**
 * Whether a statement only reads: a SELECT (optionally behind read-only CTEs), VALUES,
 * TABLE or SHOW, with no data-modifying CTE and no SELECT … INTO. Used to decide whether
 * EXPLAIN ANALYZE, which executes the statement, needs a confirmation first.
 */
export function isReadOnlyQuery(sql: string, engine: SqlEngine): boolean {
	const tokens = significant(lex(sql, engine));
	if (tokens.length === 0) return false;
	const depths = depthsOf(tokens);
	const verbIndex = mainVerbIndex(tokens, depths);
	if (verbIndex === -1 || !READ_VERBS.has(upper(tokens[verbIndex]))) return false;
	for (let i = 0; i < tokens.length; i++) {
		const word = upper(tokens[i]);
		if (!WRITE_WORDS.has(word)) continue;
		const before = i > 0 ? upper(tokens[i - 1]) : "";
		// `FOR UPDATE` locks rows but writes nothing; anything else that writes disqualifies.
		if (word === "UPDATE" && (before === "FOR" || before === "KEY")) continue;
		return false;
	}
	return true;
}

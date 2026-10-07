import { describe, expect, test } from "bun:test";
import { locateError } from "./error-position";

/** The text a span covers, for readable assertions. */
function marked(
	engine: Parameters<typeof locateError>[0],
	statement: string,
	message: string,
	position?: number,
) {
	const span = locateError(engine, statement, { message, position });
	return span ? statement.slice(span.from, span.to) : null;
}

describe("locateError", () => {
	test("Postgres: exact position", () => {
		expect(marked("postgres", "SELECT * FRM orders", 'syntax error at or near "FRM"', 10)).toBe(
			"FRM",
		);
		expect(marked("postgres", "SELECT nope FROM orders", 'column "nope" does not exist', 8)).toBe(
			"nope",
		);
	});

	test("Postgres: falls back to the quoted name", () => {
		expect(
			marked("postgres", "select * from public.nope", 'relation "public.nope" does not exist'),
		).toBe("nope");
	});

	test("MySQL / MariaDB: near … at line N", () => {
		const message =
			"You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'FROM orders' at line 2";
		expect(marked("mysql", "SELECT id,\n  FROM orders", message)).toBe("FROM");
		expect(
			marked(
				"mariadb",
				"SELECT * FRM orders",
				"You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near 'FRM orders' at line 1",
			),
		).toBe("FRM");
	});

	test("MySQL: near '' points at the end", () => {
		const span = locateError("mysql", "SELECT 1 +", {
			message: "… for the right syntax to use near '' at line 1",
		});
		expect(span).toEqual({ from: 9, to: 10 });
	});

	test("MySQL: named objects", () => {
		expect(
			marked("mysql", "SELECT nope FROM orders", "Unknown column 'nope' in 'field list'"),
		).toBe("nope");
		expect(marked("mysql", "select * from `nope`", "Table 'db_shop_dev.nope' doesn't exist")).toBe(
			"`nope`",
		);
	});

	test("libSQL: sqld parser messages", () => {
		expect(
			marked(
				"libsql",
				"SELECT * FRM orders",
				"SQL_PARSE_ERROR: SQL string could not be parsed: syntax error around L1:13: `FRM`",
			),
		).toBe("FRM");
		expect(
			marked(
				"libsql",
				"SELECT id,\n  FROM orders",
				'SQL_PARSE_ERROR: SQL string could not be parsed: near FROM, "None": syntax error at (2, 7)',
			),
		).toBe("FROM");
		expect(
			marked(
				"libsql",
				"SELECT nope FROM orders",
				"SQL_INPUT_ERROR: SQL input error: no such column: nope (at offset 7)",
			),
		).toBe("nope");
	});

	test("libSQL: SQLite messages", () => {
		expect(
			marked("libsql", "SELECT * FROM nope", "SQLITE_UNKNOWN: SQLite error: no such table: nope"),
		).toBe("nope");
		expect(marked("libsql", "SELECT 1,, 2", 'near ",": syntax error')).toBe(",");
	});

	test("unknown messages give no marker", () => {
		expect(
			locateError("postgres", "select 1", { message: "permission denied for table x" }),
		).toBeNull();
		expect(locateError("mysql", "", { message: "anything" })).toBeNull();
	});
});

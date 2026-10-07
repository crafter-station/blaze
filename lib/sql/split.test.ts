import { describe, expect, test } from "bun:test";
import { splitStatements, statementAt, statementsInRange } from "./split";

const texts = (sql: string, engine: Parameters<typeof splitStatements>[1] = "postgres") =>
	splitStatements(sql, engine).map((s) => s.text);

describe("splitStatements", () => {
	test("splits on semicolons and trims", () => {
		expect(texts("select 1;\n  select 2 ;select 3")).toEqual(["select 1", "select 2", "select 3"]);
	});

	test("reports offsets into the source", () => {
		const sql = "  select 1;\n\nselect 2;";
		const [a, b] = splitStatements(sql, "postgres");
		expect(sql.slice(a.from, a.to)).toBe("select 1");
		expect(a.end).toBe(11);
		expect(sql.slice(b.from, b.to)).toBe("select 2");
		expect(b.end).toBe(sql.length);
	});

	test("ignores semicolons in strings, identifiers and comments", () => {
		expect(
			texts(`select 'a;b', "c;d" -- e;f
from t /* g; h */; select 2`),
		).toEqual([`select 'a;b', "c;d" -- e;f\nfrom t /* g; h */`, "select 2"]);
	});

	test("handles doubled quotes", () => {
		expect(texts("select 'it''s; fine'; select 2")).toEqual(["select 'it''s; fine'", "select 2"]);
	});

	test("handles Postgres dollar quoting and E strings", () => {
		const fn = `create function f() returns int language plpgsql as $body$
begin
  return 1; -- inside
end;
$body$`;
		expect(texts(`${fn}; select $$a;b$$; select E'x\\';y'; select $1`)).toEqual([
			fn,
			"select $$a;b$$",
			"select E'x\\';y'",
			"select $1",
		]);
	});

	test("handles nested block comments in Postgres only", () => {
		expect(texts("select /* a /* b; */ c; */ 1; select 2")).toEqual([
			"select /* a /* b; */ c; */ 1",
			"select 2",
		]);
	});

	test("MySQL: backticks, hash comments and backslash escapes", () => {
		expect(texts("select `a;b` # c;d\n, 'x\\';y' from t; select 2", "mysql")).toEqual([
			"select `a;b` # c;d\n, 'x\\';y' from t",
			"select 2",
		]);
	});

	test("keeps routine bodies together (SQLite trigger)", () => {
		const trigger = `CREATE TRIGGER t AFTER INSERT ON orders BEGIN
  UPDATE customers SET country = 'PE' WHERE id = NEW.customer_id;
  INSERT INTO log VALUES (CASE WHEN 1 THEN 2 END);
END`;
		expect(texts(`${trigger}; SELECT 1`, "libsql")).toEqual([trigger, "SELECT 1"]);
	});

	test("keeps routine bodies together (MySQL procedure with IF blocks)", () => {
		const proc = `CREATE PROCEDURE p()
BEGIN
  IF (SELECT 1) THEN
    DROP TABLE IF EXISTS x;
    SELECT IF(1, 2, 3);
  END IF;
  WHILE 0 DO SELECT 1; END WHILE;
END`;
		expect(texts(`${proc};\nSELECT 2;`, "mysql")).toEqual([proc, "SELECT 2"]);
	});

	test("a plain BEGIN transaction still splits", () => {
		expect(texts("begin; update t set a = 1 where id = 2; commit;")).toEqual([
			"begin",
			"update t set a = 1 where id = 2",
			"commit",
		]);
	});

	test("drops comment-only fragments", () => {
		expect(texts("select 1; -- trailing note\n")).toEqual(["select 1"]);
		expect(texts("-- only a comment")).toEqual([]);
		expect(texts(" ;; ")).toEqual([]);
	});

	test("unterminated string swallows the rest rather than splitting inside it", () => {
		expect(texts("select 'abc; select 2")).toEqual(["select 'abc; select 2"]);
	});
});

describe("statementAt", () => {
	const sql = "select 1;\nselect 2;\n\n\nselect 3";
	const statements = splitStatements(sql, "postgres");

	test("inside a statement", () => {
		expect(statementAt(statements, sql.indexOf("2"))?.text).toBe("select 2");
	});

	test("right after the semicolon", () => {
		expect(statementAt(statements, sql.indexOf(";") + 1)?.text).toBe("select 1");
	});

	test("in blank lines between statements picks the previous one", () => {
		expect(statementAt(statements, sql.indexOf("\n\n") + 1)?.text).toBe("select 2");
	});

	test("before the first statement picks the first", () => {
		const padded = splitStatements("\n\nselect 1", "postgres");
		expect(statementAt(padded, 0)?.text).toBe("select 1");
	});

	test("empty editor", () => {
		expect(statementAt([], 0)).toBeNull();
	});
});

describe("statementsInRange", () => {
	test("maps a selection back to document offsets", () => {
		const sql = "select 0; select 1; select 2;";
		const from = sql.indexOf("select 1");
		const result = statementsInRange(sql, from, sql.length, "postgres");
		expect(result.map((s) => s.text)).toEqual(["select 1", "select 2"]);
		expect(sql.slice(result[1].from, result[1].to)).toBe("select 2");
	});
});

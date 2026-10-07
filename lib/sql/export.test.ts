import { describe, expect, test } from "bun:test";
import { cellToText, toCsv, toJson, toJsonRows, toTsv, uniqueKeys } from "./export";

const columns = [{ name: "id" }, { name: "note" }, { name: "meta" }];

describe("cellToText", () => {
	test("renders every value kind", () => {
		expect(cellToText(null)).toBe("");
		expect(cellToText(undefined)).toBe("");
		expect(cellToText(12.5)).toBe("12.5");
		expect(cellToText(false)).toBe("false");
		expect(cellToText("x")).toBe("x");
		expect(cellToText({ a: [1, 2] })).toBe('{"a":[1,2]}');
	});
});

describe("toCsv", () => {
	test("header, quoting and NULL", () => {
		const csv = toCsv(columns, [
			[1, "plain", null],
			[2, 'has "quotes", commas', { a: 1 }],
			[3, "line\nbreak", null],
		]);
		expect(csv).toBe(
			'id,note,meta\r\n1,plain,\r\n2,"has ""quotes"", commas","{""a"":1}"\r\n3,"line\nbreak",\r\n',
		);
	});

	test("quotes header names that need it", () => {
		expect(toCsv([{ name: "a,b" }], [])).toBe('"a,b"\r\n');
	});
});

describe("toTsv", () => {
	test("tab separated with optional header", () => {
		expect(toTsv(columns, [[1, "x", null]])).toBe("id\tnote\tmeta\n1\tx\t");
		expect(toTsv(null, [[1, "a\tb"]])).toBe('1\t"a\tb"');
	});
});

describe("JSON", () => {
	test("duplicate column names get a suffix", () => {
		expect(uniqueKeys([{ name: "id" }, { name: "id" }, { name: "x" }, { name: "id" }])).toEqual([
			"id",
			"id_2",
			"x",
			"id_3",
		]);
	});

	test("rows become objects, NULL stays null, JSON stays structured", () => {
		expect(toJsonRows(columns, [[1, null, { a: 1 }]])).toEqual([
			{ id: 1, note: null, meta: { a: 1 } },
		]);
		expect(JSON.parse(toJson(columns, [[1, "x", null]]))).toEqual([
			{ id: 1, note: "x", meta: null },
		]);
	});
});

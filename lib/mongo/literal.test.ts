import { describe, expect, test } from "bun:test";
import {
	bsonTypeOf,
	LiteralParseError,
	newObjectIdHex,
	parseDocument,
	parseLiteral,
	toShell,
} from "./literal";

describe("parseLiteral: relaxed JSON", () => {
	test("plain JSON passes through", () => {
		expect(parseLiteral('{"a": 1, "b": [true, null, "x"], "c": {"d": -2.5e3}}')).toEqual({
			a: 1,
			b: [true, null, "x"],
			c: { d: -2500 },
		});
	});

	test("unquoted keys, single quotes, trailing commas and comments", () => {
		expect(
			parseLiteral(`{
				status: 'paid', // inline
				$or: [ { a: 1, }, /* block */ { b: "it's" }, ],
				_id: 3,
			}`),
		).toEqual({ status: "paid", $or: [{ a: 1 }, { b: "it's" }], _id: 3 });
	});

	test("unquoted dotted paths are read as field paths", () => {
		expect(parseLiteral("{ address.city: 'Lima', items.0.sku: 1 }")).toEqual({
			"address.city": "Lima",
			"items.0.sku": 1,
		});
	});

	test("string escapes", () => {
		expect(parseLiteral(String.raw`"a\nb\té\x41\"q\""`)).toBe('a\nb\téA"q"');
		expect(parseLiteral("`template`")).toBe("template");
	});

	test("numbers: hex, signs, underscores, special values", () => {
		expect(parseLiteral("0x1F")).toBe(31);
		expect(parseLiteral("-.5")).toBe(-0.5);
		expect(parseLiteral("1_000")).toBe(1000);
		expect(parseLiteral("Infinity")).toEqual({ $numberDouble: "Infinity" });
		expect(parseLiteral("-Infinity")).toEqual({ $numberDouble: "-Infinity" });
		expect(parseLiteral("NaN")).toEqual({ $numberDouble: "NaN" });
	});

	test("undefined is read as null", () => {
		expect(parseLiteral("{ a: undefined }")).toEqual({ a: null });
	});

	test("regex literals become $regularExpression, with sorted Mongo options", () => {
		expect(parseLiteral("/^ab[/]c\\/d/mi")).toEqual({
			$regularExpression: { pattern: "^ab[/]c\\/d", options: "im" },
		});
		expect(() => parseLiteral("/x/g")).toThrow(/flag "g"/);
	});
});

describe("parseLiteral: shell type constructors", () => {
	test("ObjectId", () => {
		expect(parseLiteral('ObjectId("6ac945381d3fd16de924a6a7")')).toEqual({
			$oid: "6ac945381d3fd16de924a6a7",
		});
		expect(parseLiteral("new ObjectId('6AC945381D3FD16DE924A6A7')")).toEqual({
			$oid: "6ac945381d3fd16de924a6a7",
		});
		const fresh = parseLiteral("ObjectId()") as { $oid: string };
		expect(fresh.$oid).toMatch(/^[0-9a-f]{24}$/);
		expect(() => parseLiteral('ObjectId("nope")')).toThrow(/24 hexadecimal/);
	});

	test("dates", () => {
		expect(parseLiteral('ISODate("2026-01-02")')).toEqual({ $date: "2026-01-02T00:00:00.000Z" });
		expect(parseLiteral('new Date("2026-01-02T03:04:05Z")')).toEqual({
			$date: "2026-01-02T03:04:05.000Z",
		});
		expect(parseLiteral("Date(0)")).toEqual({ $date: "1970-01-01T00:00:00.000Z" });
		expect((parseLiteral("ISODate()") as { $date: string }).$date).toMatch(/^\d{4}-/);
		expect(() => parseLiteral('ISODate("yesterday-ish")')).toThrow(/valid date/);
	});

	test("numeric types", () => {
		expect(parseLiteral('NumberLong("9007199254740993")')).toEqual({
			$numberLong: "9007199254740993",
		});
		expect(parseLiteral("NumberLong(42)")).toEqual({ $numberLong: "42" });
		expect(parseLiteral("NumberInt(7)")).toEqual({ $numberInt: "7" });
		expect(() => parseLiteral("NumberInt(3000000000)")).toThrow(/32-bit/);
		expect(parseLiteral('NumberDecimal("19.99")')).toEqual({ $numberDecimal: "19.99" });
		expect(parseLiteral("Decimal128('1E+3')")).toEqual({ $numberDecimal: "1E+3" });
		expect(parseLiteral("Double(1)")).toEqual({ $numberDouble: "1.0" });
		expect(() => parseLiteral("NumberLong(1.5)")).toThrow(/integer/);
	});

	test("binary, UUID, timestamp, keys, RegExp", () => {
		expect(parseLiteral('BinData(0, "aGk=")')).toEqual({
			$binary: { base64: "aGk=", subType: "00" },
		});
		expect(parseLiteral('HexData(0, "6869")')).toEqual({
			$binary: { base64: "aGk=", subType: "00" },
		});
		expect(parseLiteral('UUID("0123456789abcdef0123456789ABCDEF")')).toEqual({
			$uuid: "01234567-89ab-cdef-0123-456789abcdef",
		});
		expect(parseLiteral("Timestamp(5, 1)")).toEqual({ $timestamp: { t: 5, i: 1 } });
		expect(parseLiteral("Timestamp({ t: 5, i: 2 })")).toEqual({ $timestamp: { t: 5, i: 2 } });
		expect(parseLiteral("MinKey")).toEqual({ $minKey: 1 });
		expect(parseLiteral("MaxKey()")).toEqual({ $maxKey: 1 });
		expect(parseLiteral('RegExp("a.c", "i")')).toEqual({
			$regularExpression: { pattern: "a.c", options: "i" },
		});
	});

	test("Extended JSON written by hand passes through unchanged", () => {
		expect(parseLiteral('{ "_id": { "$oid": "6ac945381d3fd16de924a6a7" } }')).toEqual({
			_id: { $oid: "6ac945381d3fd16de924a6a7" },
		});
	});
});

describe("parseLiteral: errors carry a position", () => {
	const fail = (source: string) => {
		try {
			parseLiteral(source);
		} catch (e) {
			expect(e).toBeInstanceOf(LiteralParseError);
			return e as LiteralParseError;
		}
		throw new Error(`expected ${source} to fail`);
	};

	test("unknown identifiers explain that strings need quotes", () => {
		const e = fail("{ status: paid }");
		expect(e.message).toMatch(/Strings need quotes/);
		expect(e.position).toBe(10);
	});

	test("missing separators and unterminated input", () => {
		expect(fail("{ a: 1 b: 2 }").message).toMatch(/"," or "}"/);
		expect(fail("{ a: 'x").message).toMatch(/Unterminated string/);
		expect(fail("[1, 2").message).toMatch(/end of input/);
		expect(fail("{ a: 1 } trailing").message).toMatch(/after the value/);
		expect(fail(["`$", "{x}`"].join("")).message).toMatch(/interpolation/);
		expect(fail("Function('x')").message).toMatch(/Unknown type/);
	});

	test("parseDocument insists on a document", () => {
		expect(() => parseDocument("[1]")).toThrow(/document/);
		expect(parseDocument("{}")).toEqual({});
	});
});

describe("toShell", () => {
	test("prints shell syntax that parses back to the same value", () => {
		const value = parseLiteral(`{
			_id: ObjectId("6ac945381d3fd16de924a6a7"),
			at: ISODate("2026-01-02T00:00:00.000Z"),
			big: NumberLong("12"),
			price: NumberDecimal("9.99"),
			re: /a\\/b/i,
			"odd key": [1, "two", { nested: true }],
			bin: BinData(4, "AAAA"),
			ts: Timestamp(1, 2),
		}`);
		const printed = toShell(value);
		expect(printed).toContain('ObjectId("6ac945381d3fd16de924a6a7")');
		expect(printed).toContain('"odd key"');
		expect(parseLiteral(printed)).toEqual(value);
		expect(parseLiteral(toShell(value, 0))).toEqual(value);
	});

	test("short values stay on one line", () => {
		expect(toShell({ a: 1, b: [1, 2] })).toBe("{ a: 1, b: [ 1, 2 ] }");
	});
});

describe("bsonTypeOf", () => {
	test("names Extended JSON wrappers", () => {
		expect(bsonTypeOf({ $oid: "x" })).toBe("objectId");
		expect(bsonTypeOf({ $date: "x" })).toBe("date");
		expect(bsonTypeOf({ $numberDecimal: "1" })).toBe("decimal");
		expect(bsonTypeOf(1)).toBe("int");
		expect(bsonTypeOf(1.5)).toBe("double");
		expect(bsonTypeOf([1])).toBe("array");
		expect(bsonTypeOf({ a: 1 })).toBe("object");
		expect(bsonTypeOf(undefined)).toBe("missing");
	});

	test("newObjectIdHex leads with the timestamp", () => {
		expect(newObjectIdHex(0x5f5e1000 * 1000).slice(0, 8)).toBe("5f5e1000");
	});
});

describe("Extended JSON output is what the driver understands", () => {
	test("EJSON.deserialize turns every constructor into its BSON type", async () => {
		const { BSON } = await import("mongodb");
		const value = parseLiteral(`{
			id: ObjectId("6ac945381d3fd16de924a6a7"), at: ISODate("2026-01-02"), n: NumberLong(5),
			i: NumberInt(3), d: NumberDecimal("1.5"), f: Double(2), re: /x/i, b: BinData(0, "aGk="),
			u: UUID("01234567-89ab-cdef-0123-456789abcdef"), t: Timestamp(1, 2), lo: MinKey, plain: 7,
		}`);
		const doc = BSON.EJSON.deserialize(value as object, { relaxed: false }) as Record<
			string,
			unknown
		>;
		expect(doc.id).toBeInstanceOf(BSON.ObjectId);
		expect(doc.at).toBeInstanceOf(Date);
		expect(doc.n).toBeInstanceOf(BSON.Long);
		expect(doc.i).toBeInstanceOf(BSON.Int32);
		expect(doc.d).toBeInstanceOf(BSON.Decimal128);
		expect(doc.f).toBeInstanceOf(BSON.Double);
		expect(doc.re).toBeInstanceOf(BSON.BSONRegExp);
		expect(doc.b).toBeInstanceOf(BSON.Binary);
		expect(doc.u).toBeInstanceOf(BSON.Binary);
		expect(doc.t).toBeInstanceOf(BSON.Timestamp);
		expect(doc.lo).toBeInstanceOf(BSON.MinKey);
	});
});

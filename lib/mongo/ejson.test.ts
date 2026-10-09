import { describe, expect, test } from "bun:test";
import { BSON } from "mongodb";
import { displayDocuments, fromEJson, parseBsonDocument, toDisplay } from "./ejson";
import { parseLiteral, toShell } from "./literal";

const canonical = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });

describe("display Extended JSON", () => {
	const doc = {
		_id: new BSON.ObjectId("6ac945381d3fd16de924a6a7"),
		i: 5,
		d: 1.5,
		whole: new BSON.Double(2),
		l: BSON.Long.fromNumber(7),
		dec: BSON.Decimal128.fromString("9.99"),
		at: new Date(0),
		re: new BSON.BSONRegExp("a/b", "i"),
		bin: new BSON.Binary(Buffer.from("hi")),
		ts: new BSON.Timestamp({ t: 1, i: 2 }),
		n: null,
		nested: [1, { x: new BSON.Int32(3) }],
	};

	test("drops noise, keeps every type that would otherwise be lost", () => {
		const shown = toDisplay(doc) as Record<string, unknown>;
		expect(shown.i).toBe(5);
		expect(shown.d).toBe(1.5);
		expect(shown.whole).toEqual({ $numberDouble: "2.0" });
		expect(shown.l).toEqual({ $numberLong: "7" });
		expect(shown.dec).toEqual({ $numberDecimal: "9.99" });
		expect(shown.at).toEqual({ $date: "1970-01-01T00:00:00.000Z" });
		expect(shown.nested).toEqual([1, { x: 3 }]);
	});

	test("display -> shell text -> parse -> BSON is the identity", () => {
		const text = toShell(toDisplay(doc));
		expect(canonical(fromEJson(parseLiteral(text)))).toBe(canonical(doc));
	});

	test("parseBsonDocument: empty means {}, non-documents are refused", () => {
		expect(parseBsonDocument("  ", "Filter")).toEqual({});
		const filter = parseBsonDocument("{ _id: ObjectId('6ac945381d3fd16de924a6a7') }", "Filter");
		expect(filter._id).toBeInstanceOf(BSON.ObjectId);
		expect(() => parseBsonDocument("[1]", "Filter")).toThrow(/Filter must be a document/);
	});

	test("displayDocuments stops at the byte budget but always returns one", () => {
		const big = { s: "x".repeat(1000) };
		const out = displayDocuments([big, big, big], 2500);
		expect(out.docs.length).toBe(2);
		expect(out.clipped).toBe(true);
		expect(displayDocuments([big], 10).docs.length).toBe(1);
	});
});

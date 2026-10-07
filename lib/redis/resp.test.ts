import { describe, expect, test } from "bun:test";
import { asPairs, encodeCommand, RespParser, type RespValue, respToJs } from "./resp";

const enc = new TextEncoder();
const dec = new TextDecoder();

function parseAll(...chunks: string[]): RespValue[] {
	const parser = new RespParser();
	const out: RespValue[] = [];
	for (const chunk of chunks) {
		parser.push(enc.encode(chunk));
		for (let v = parser.next(); v; v = parser.next()) out.push(v);
	}
	return out;
}

const text = (v: RespValue) => (v.type === "bulk" ? dec.decode(v.value) : null);

describe("encodeCommand", () => {
	test("encodes a RESP array of bulk strings, binary-safe", () => {
		expect(dec.decode(encodeCommand(["SET", "k", "héllo"]))).toBe(
			"*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$6\r\nhéllo\r\n",
		);
		const raw = encodeCommand(["X", new Uint8Array([0xff, 0x0d, 0x0a])]);
		expect([...raw.slice(-5)]).toEqual([0xff, 0x0d, 0x0a, 0x0d, 0x0a]);
	});
});

describe("RespParser", () => {
	test("parses RESP2 scalars", () => {
		const [ok, err, int, bulk, nil, nilArray] = parseAll(
			"+OK\r\n-ERR bad\r\n:42\r\n$5\r\nhello\r\n$-1\r\n*-1\r\n",
		);
		expect(ok).toEqual({ type: "simple", value: "OK" });
		expect(err).toEqual({ type: "error", value: "ERR bad" });
		expect(int).toEqual({ type: "integer", value: "42" });
		expect(text(bulk)).toBe("hello");
		expect(nil).toEqual({ type: "null" });
		expect(nilArray).toEqual({ type: "null" });
	});

	test("parses RESP3 types", () => {
		const values = parseAll(
			"_\r\n#t\r\n#f\r\n,3.14\r\n,inf\r\n(3492890328409238509324850943850943825024385\r\n!21\r\nSYNTAX invalid syntax\r\n=15\r\ntxt:Some string\r\n",
		);
		expect(values.map((v) => v.type)).toEqual([
			"null",
			"boolean",
			"boolean",
			"double",
			"double",
			"bignum",
			"error",
			"verbatim",
		]);
		expect(values[1]).toEqual({ type: "boolean", value: true });
		expect(values[6]).toEqual({ type: "error", value: "SYNTAX invalid syntax" });
		const verbatim = values[7] as Extract<RespValue, { type: "verbatim" }>;
		expect(verbatim.format).toBe("txt");
		expect(dec.decode(verbatim.value)).toBe("Some string");
	});

	test("parses nested aggregates: arrays, maps, sets", () => {
		const [value] = parseAll(
			"*3\r\n:1\r\n*2\r\n+a\r\n$1\r\nb\r\n%2\r\n+k1\r\n:1\r\n+k2\r\n~2\r\n:1\r\n:2\r\n",
		);
		expect(value.type).toBe("array");
		const items = (value as Extract<RespValue, { items: RespValue[] }>).items;
		expect(items[0]).toEqual({ type: "integer", value: "1" });
		expect(items[1].type).toBe("array");
		const map = items[2] as Extract<RespValue, { type: "map" }>;
		expect(map.entries.length).toBe(2);
		expect(map.entries[1][1].type).toBe("set");
	});

	test("handles empty aggregates", () => {
		const values = parseAll("*0\r\n%0\r\n~0\r\n");
		expect(values).toEqual([
			{ type: "array", items: [] },
			{ type: "map", entries: [] },
			{ type: "set", items: [] },
		]);
	});

	test("resumes across arbitrary chunk boundaries", () => {
		const wire = "*2\r\n$10\r\n0123456789\r\n%1\r\n+key\r\n*1\r\n:7\r\n+NEXT\r\n";
		// Every possible split point, including inside CRLF and inside a bulk body.
		for (let cut = 1; cut < wire.length; cut++) {
			const values = parseAll(wire.slice(0, cut), wire.slice(cut));
			expect(values.length).toBe(2);
			expect(values[1]).toEqual({ type: "simple", value: "NEXT" });
		}
		// One byte at a time.
		const parser = new RespParser();
		const out: RespValue[] = [];
		for (const ch of wire) {
			parser.push(enc.encode(ch));
			for (let v = parser.next(); v; v = parser.next()) out.push(v);
		}
		expect(out.length).toBe(2);
	});

	test("keeps binary bulk bytes intact, including CRLF inside", () => {
		const parser = new RespParser();
		parser.push(new Uint8Array([0x24, 0x34, 0x0d, 0x0a, 0xff, 0x0d, 0x0a, 0x00, 0x0d, 0x0a]));
		const value = parser.next();
		expect(value?.type).toBe("bulk");
		expect([...(value as Extract<RespValue, { type: "bulk" }>).value]).toEqual([
			0xff, 0x0d, 0x0a, 0x00,
		]);
	});

	test("discards attributes and returns the reply they annotate", () => {
		const values = parseAll("|1\r\n+ttl\r\n:3600\r\n$2\r\nhi\r\n");
		expect(values.length).toBe(1);
		expect(text(values[0])).toBe("hi");
		// Attribute inside an array element.
		const [array] = parseAll("*2\r\n|1\r\n+a\r\n+b\r\n:1\r\n:2\r\n");
		expect((array as Extract<RespValue, { items: RespValue[] }>).items).toEqual([
			{ type: "integer", value: "1" },
			{ type: "integer", value: "2" },
		]);
	});

	test("tracks bytes not yet consumed", () => {
		const parser = new RespParser();
		parser.push(enc.encode("$100\r\nabc"));
		expect(parser.next()).toBeUndefined();
		expect(parser.pendingBytes).toBe(9);
	});

	test("rejects garbage", () => {
		expect(() => parseAll("?what\r\n")).toThrow();
	});
});

describe("respToJs and asPairs", () => {
	test("decode maps to objects and flat RESP2 arrays to pairs", () => {
		const [map] = parseAll("%2\r\n+a\r\n:1\r\n+b\r\n*2\r\n+x\r\n,1.5\r\n");
		expect(respToJs(map)).toEqual({ a: 1, b: ["x", 1.5] });
		const [flat] = parseAll("*4\r\n$1\r\na\r\n:1\r\n$1\r\nb\r\n:2\r\n");
		expect(asPairs(flat).map(([k]) => k)).toEqual(["a", "b"]);
		expect(asPairs(map).map(([k]) => k)).toEqual(["a", "b"]);
	});
});

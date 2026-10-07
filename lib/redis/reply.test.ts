import { describe, expect, test } from "bun:test";
import { formatReply, friendlyRedisError, isOomError, toReply } from "./reply";
import type { RespValue } from "./resp";

const enc = new TextEncoder();
const bulk = (s: string | number[]): RespValue => ({
	type: "bulk",
	value: typeof s === "string" ? enc.encode(s) : Uint8Array.from(s),
});
const int = (n: number): RespValue => ({ type: "integer", value: String(n) });

describe("toReply", () => {
	test("maps every RESP type to a JSON-safe reply", () => {
		expect(toReply({ type: "simple", value: "OK" }).reply).toEqual({ t: "simple", v: "OK" });
		expect(toReply({ type: "null" }).reply).toEqual({ t: "nil" });
		expect(toReply({ type: "integer", value: "9007199254740993" }).reply).toEqual({
			t: "int",
			v: "9007199254740993",
		});
		expect(toReply({ type: "boolean", value: false }).reply).toEqual({ t: "bool", v: false });
		expect(toReply(bulk("hi")).reply).toEqual({ t: "bulk", v: "hi", len: 2 });
		const reply = toReply({ type: "map", entries: [[bulk("f"), bulk("v")]] }).reply;
		expect(JSON.parse(JSON.stringify(reply))).toEqual(reply);
	});

	test("marks binary bulk strings and ships hex", () => {
		const { reply } = toReply(bulk([0xff, 0x00, 0x41]));
		expect(reply).toEqual({ t: "bulk", v: "\\xff\\x00A", len: 3, binary: true, hex: "ff0041" });
	});

	test("caps elements across the whole tree", () => {
		const big: RespValue = { type: "array", items: Array.from({ length: 50 }, (_, i) => int(i)) };
		const { reply, truncated } = toReply(big, {
			maxElements: 10,
			maxBytes: 1e6,
			maxStringBytes: 1e6,
		});
		expect(truncated).toBe(true);
		expect(reply.t === "array" && reply.items.length).toBe(10);
		expect(reply.t === "array" && reply.len).toBe(50);
		expect(reply.t === "array" && reply.truncated).toBe(true);
	});

	test("caps string bytes without splitting a UTF-8 character", () => {
		const { reply, truncated } = toReply(bulk("ééééé"), {
			maxElements: 10,
			maxBytes: 1e6,
			maxStringBytes: 5,
		});
		expect(truncated).toBe(true);
		expect(reply).toEqual({ t: "bulk", v: "éé", len: 10, truncated: true });
	});

	test("caps total bytes across strings", () => {
		const value: RespValue = { type: "array", items: [bulk("aaaa"), bulk("bbbb"), bulk("cccc")] };
		const { reply } = toReply(value, { maxElements: 100, maxBytes: 6, maxStringBytes: 100 });
		if (reply.t !== "array") throw new Error("expected array");
		expect(reply.items.map((r) => (r.t === "bulk" ? r.v : null))).toEqual(["aaaa", "bb", ""]);
	});
});

describe("formatReply", () => {
	const fmt = (v: RespValue) => formatReply(toReply(v).reply);

	test("prints scalars like redis-cli", () => {
		expect(fmt({ type: "simple", value: "OK" })).toBe("OK");
		expect(fmt(int(5))).toBe("(integer) 5");
		expect(fmt({ type: "null" })).toBe("(nil)");
		expect(fmt({ type: "error", value: "ERR nope" })).toBe("(error) ERR nope");
		expect(fmt(bulk('say "hi"\n'))).toBe('"say \\"hi\\"\\n"');
		expect(fmt({ type: "double", value: "1.5" })).toBe("(double) 1.5");
		expect(fmt({ type: "boolean", value: true })).toBe("(true)");
	});

	test("numbers arrays and aligns nested ones", () => {
		const value: RespValue = {
			type: "array",
			items: [
				bulk("a"),
				{ type: "array", items: [bulk("b"), int(2)] },
				{ type: "array", items: [] },
			],
		};
		expect(fmt(value)).toBe(
			['1) "a"', '2) 1) "b"', "   2) (integer) 2", "3) (empty array)"].join("\n"),
		);
	});

	test("pads indexes to the widest one", () => {
		const value: RespValue = { type: "array", items: Array.from({ length: 10 }, (_, i) => int(i)) };
		const lines = fmt(value).split("\n");
		expect(lines[0]).toBe(" 1) (integer) 0");
		expect(lines[9]).toBe("10) (integer) 9");
	});

	test("prints maps and sets with RESP3 markers", () => {
		const map: RespValue = {
			type: "map",
			entries: [
				[bulk("name"), bulk("ada")],
				[bulk("age"), int(36)],
			],
		};
		expect(fmt(map)).toBe('1# "name" => "ada"\n2# "age" => (integer) 36');
		expect(fmt({ type: "set", items: [bulk("x")] })).toBe('1~ "x"');
		expect(fmt({ type: "map", entries: [] })).toBe("(empty hash)");
	});

	test("says how much was left out of a truncated reply", () => {
		const big: RespValue = { type: "array", items: Array.from({ length: 5 }, (_, i) => int(i)) };
		const text = formatReply(
			toReply(big, { maxElements: 2, maxBytes: 1e6, maxStringBytes: 1e6 }).reply,
		);
		expect(text.split("\n").at(-1)).toBe("(3 more not shown)");
	});
});

describe("friendlyRedisError", () => {
	test("explains the memory limit in plain words", () => {
		const raw = "OOM command not allowed when used memory > 'maxmemory'.";
		expect(isOomError(raw)).toBe(true);
		expect(friendlyRedisError(raw)).toMatch(/^Database is full: 64 MB limit/);
		expect(
			friendlyRedisError("NOPERM User default has no permissions to run the 'config|get' command"),
		).toMatch(/not allowed/);
		expect(friendlyRedisError("ERR syntax error")).toBeNull();
	});
});

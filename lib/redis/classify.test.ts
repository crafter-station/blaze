import { describe, expect, test } from "bun:test";
import { BLOCKING_CAP_SECONDS, capBlockingTimeout, classify, isBlockingCommand } from "./classify";

describe("classify", () => {
	test("blocks commands that need a persistent connection", () => {
		for (const name of [
			"SUBSCRIBE",
			"psubscribe",
			"SSubscribe",
			"MONITOR",
			"SYNC",
			"PSYNC",
			"HELLO",
		]) {
			expect(classify([name, "x"]).blocked).toBeTruthy();
		}
		expect(classify(["SUBSCRIBE", "news"]).blocked).toMatch(/connection/);
		expect(classify(["CLIENT", "reply", "off"]).blocked).toBeTruthy();
	});

	test("lets ordinary commands through, naming container subcommands", () => {
		expect(classify(["get", "k"])).toEqual({ name: "GET" });
		expect(classify(["client", "list"])).toEqual({ name: "CLIENT LIST" });
		expect(classify(["PUBLISH", "ch", "msg"]).blocked).toBeUndefined();
	});

	test("asks before FLUSHDB, FLUSHALL and multi-key DEL/UNLINK", () => {
		expect(classify(["FLUSHDB"]).confirm).toBeTruthy();
		expect(classify(["flushall", "async"]).confirm).toBeTruthy();
		expect(classify(["DEL", "a", "b"]).confirm).toMatch(/2 keys/);
		expect(classify(["unlink", "a", "b", "c"]).confirm).toMatch(/3 keys/);
		expect(classify(["DEL", "a"]).confirm).toBeUndefined();
		expect(classify(["UNLINK", "a"]).confirm).toBeUndefined();
	});
});

describe("capBlockingTimeout", () => {
	const cap = BLOCKING_CAP_SECONDS;

	test("caps zero (wait forever) and long timeouts in seconds", () => {
		expect(capBlockingTimeout(["BLPOP", "q", "0"]).args).toEqual(["BLPOP", "q", String(cap)]);
		expect(capBlockingTimeout(["BRPOP", "a", "b", "60"]).args).toEqual([
			"BRPOP",
			"a",
			"b",
			String(cap),
		]);
		expect(capBlockingTimeout(["BZPOPMIN", "z", "30.5"]).args.at(-1)).toBe(String(cap));
		expect(capBlockingTimeout(["BLMOVE", "a", "b", "LEFT", "RIGHT", "0"]).args.at(-1)).toBe(
			String(cap),
		);
		expect(capBlockingTimeout(["BRPOPLPUSH", "a", "b", "100"]).args.at(-1)).toBe(String(cap));
		const rewritten = capBlockingTimeout(["BLPOP", "q", "0"]);
		expect(rewritten.note).toMatch(/wait forever/);
		expect(rewritten.index).toBe(2);
	});

	test("leaves short timeouts alone", () => {
		expect(capBlockingTimeout(["BLPOP", "q", "2"])).toEqual({ args: ["BLPOP", "q", "2"] });
		expect(capBlockingTimeout(["BLPOP", "q", "0.5"]).note).toBeUndefined();
		expect(capBlockingTimeout(["BLPOP", "q", String(cap)]).note).toBeUndefined();
	});

	test("handles timeouts that come first (BLMPOP, BZMPOP)", () => {
		expect(capBlockingTimeout(["BLMPOP", "0", "1", "q", "LEFT"]).args).toEqual([
			"BLMPOP",
			String(cap),
			"1",
			"q",
			"LEFT",
		]);
		expect(capBlockingTimeout(["BZMPOP", "10", "1", "z", "MIN"]).args[1]).toBe(String(cap));
	});

	test("caps BLOCK in XREAD and XREADGROUP, in milliseconds", () => {
		expect(capBlockingTimeout(["XREAD", "BLOCK", "0", "STREAMS", "s", "$"]).args).toEqual([
			"XREAD",
			"BLOCK",
			String(cap * 1000),
			"STREAMS",
			"s",
			"$",
		]);
		expect(
			capBlockingTimeout([
				"XREADGROUP",
				"GROUP",
				"g",
				"c",
				"COUNT",
				"5",
				"BLOCK",
				"60000",
				"STREAMS",
				"s",
				">",
			]).args[7],
		).toBe(String(cap * 1000));
		expect(
			capBlockingTimeout(["XREAD", "BLOCK", "1000", "STREAMS", "s", "$"]).note,
		).toBeUndefined();
		// Without BLOCK, XREAD does not block; a stream literally named "block" is a key.
		expect(capBlockingTimeout(["XREAD", "STREAMS", "block", "0"]).note).toBeUndefined();
		expect(isBlockingCommand(["XREAD", "COUNT", "1", "STREAMS", "s", "0"])).toBe(false);
	});

	test("caps WAIT and WAITAOF in milliseconds", () => {
		expect(capBlockingTimeout(["WAIT", "1", "0"]).args).toEqual(["WAIT", "1", String(cap * 1000)]);
		expect(capBlockingTimeout(["WAITAOF", "1", "0", "0"]).args[3]).toBe(String(cap * 1000));
		expect(capBlockingTimeout(["WAIT", "1", "100"]).note).toBeUndefined();
	});

	test("leaves non-numeric or negative timeouts for Redis to reject", () => {
		expect(capBlockingTimeout(["BLPOP", "q", "soon"]).note).toBeUndefined();
		expect(capBlockingTimeout(["BLPOP", "q", "-1"]).note).toBeUndefined();
	});

	test("ignores commands that do not block", () => {
		expect(capBlockingTimeout(["LPOP", "q", "0"])).toEqual({ args: ["LPOP", "q", "0"] });
		expect(isBlockingCommand(["GET", "k"])).toBe(false);
		expect(isBlockingCommand(["BLPOP", "q", "1"])).toBe(true);
	});
});

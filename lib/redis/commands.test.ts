import { describe, expect, test } from "bun:test";
import {
	commandHint,
	indexFromNames,
	keyPositions,
	lookupCommand,
	parseCommandDocs,
	renderSyntax,
} from "./commands";
import docs from "./fixtures/command-docs.json";

// A slice of a real `COMMAND DOCS` reply from redis:8, decoded with respToJs.
const index = parseCommandDocs(docs);
const hint = (line: string) => commandHint(index, line.trim().split(/\s+/))?.hint;

describe("parseCommandDocs", () => {
	test("indexes commands, module commands and container subcommands", () => {
		expect(index.SET.summary).toBeTruthy();
		expect(index.SET.group).toBe("string");
		expect(index["JSON.SET"].module).toBe("ReJSON");
		expect(index.CLIENT.subcommands).toContain("LIST");
		expect(index["CLIENT LIST"]).toBeDefined();
	});

	test("accepts RESP2-shaped (flat array) docs too", () => {
		const flat = parseCommandDocs([
			"get",
			[
				"summary",
				"Returns the string value of a key.",
				"arguments",
				[["name", "key", "type", "key"]],
			],
		]);
		expect(flat.GET.args[0]).toEqual({ name: "key", type: "key" });
	});

	test("renders documented syntax", () => {
		expect(renderSyntax(index.GET)).toBe("GET key");
		expect(renderSyntax(index.DEL)).toBe("DEL key [key ...]");
		expect(renderSyntax(index.SET)).toMatch(
			/^SET key value \[NX \| XX \| IFEQ ifeq-value.*\] \[GET\] \[EX seconds \| PX milliseconds \| EXAT unix-time-seconds \| PXAT unix-time-milliseconds \| KEEPTTL\]$/,
		);
	});
});

describe("commandHint", () => {
	test("shows the arguments still to come, like redis-cli", () => {
		expect(hint("GET")).toBe("key");
		expect(hint("GET k")).toBe("");
		expect(hint("SET")).toMatch(/^key value \[NX/);
		expect(hint("SET k")).toMatch(/^value \[NX/);
		expect(hint("SET k v")).toMatch(/^\[NX \| XX/);
	});

	test("skips optional arguments once a later one is typed", () => {
		expect(hint("SET k v GET")).toBe(
			"[EX seconds | PX milliseconds | EXAT unix-time-seconds | PXAT unix-time-milliseconds | KEEPTTL]",
		);
		expect(hint("SET k v NX EX")).toBe("seconds");
		expect(hint("SET k v NX EX 10")).toBe("");
		expect(hint("set k v ex 10")).toBe("");
	});

	test("repeats multiple arguments", () => {
		expect(hint("DEL")).toBe("key [key ...]");
		expect(hint("DEL a")).toBe("[key ...]");
		expect(hint("DEL a b c")).toBe("[key ...]");
	});

	test("lets a fixed word end a repeated value list", () => {
		// SCAN cursor [MATCH pattern] [COUNT count] [TYPE type]
		expect(hint("SCAN 0")).toMatch(/^\[MATCH pattern\] \[COUNT count\] \[TYPE type\]/);
		expect(hint("SCAN 0 MATCH")).toMatch(/^pattern \[COUNT count\]/);
		expect(hint("SCAN 0 COUNT 10")).toMatch(/^\[TYPE type\]/);
	});

	test("walks blocks such as XADD's trimming options", () => {
		expect(hint("XADD")).toMatch(/^key /);
		expect(hint("XADD s *")).toMatch(/^field value \[field value \.\.\.\]$/);
		expect(hint("XADD s * f v")).toBe("[field value ...]");
	});

	test("hints container subcommands", () => {
		expect(hint("CLIENT")).toMatch(/^<.*LIST/);
		expect(hint("CLIENT LIST")).toMatch(/TYPE/);
		expect(lookupCommand(index, ["client", "list"])?.spec.name).toBe("CLIENT LIST");
	});

	test("offers the words that can come next", () => {
		const after = commandHint(index, ["SET", "k", "v"]);
		expect(after?.expect).toEqual(
			expect.arrayContaining(["NX", "XX", "GET", "EX", "PX", "KEEPTTL"]),
		);
		expect(after?.expectValue).toBe(false);
		const scan = commandHint(index, ["SCAN", "0", "MATCH", "*"]);
		expect(scan?.expect).toEqual(expect.arrayContaining(["COUNT", "TYPE"]));
		expect(scan?.expect).not.toContain("MATCH");
	});

	test("knows which arguments are keys", () => {
		expect(keyPositions(index, ["GET", "user:1"])).toEqual([1]);
		expect(keyPositions(index, ["DEL", "a", "b"])).toEqual([1, 2]);
		expect(keyPositions(index, ["SET", "k", "v", "EX", "10"])).toEqual([1]);
		expect(keyPositions(index, ["JSON.SET", "doc", "$", "{}"])).toEqual([1]);
	});

	test("returns null for unknown commands", () => {
		expect(commandHint(index, ["NOPE"])).toBeNull();
	});
});

describe("indexFromNames", () => {
	test("builds a names-only index from COMMAND LIST", () => {
		const names = indexFromNames(["get", "client|list", "client|kill"]);
		expect(names.GET.args).toEqual([]);
		expect(names.CLIENT.subcommands).toEqual(["KILL", "LIST"]);
	});
});

import { describe, expect, test } from "bun:test";
import {
	buildTree,
	groupKeyPatterns,
	type KeyEntry,
	looksLikeId,
	type TreeFolder,
	visibleRows,
} from "./tree";

const entry = (name: string, type = "string"): KeyEntry => ({ key: name, name, type, ttl: -1 });

describe("buildTree", () => {
	test("groups keys into folders on the delimiter, folders first, natural order", () => {
		const tree = buildTree(
			["user:10", "user:2", "session:a", "config", "user:2:profile"].map((n) => entry(n)),
		);
		expect(tree.map((n) => `${n.kind}:${n.label}`)).toEqual([
			"folder:session",
			"folder:user",
			"key:config",
		]);
		const user = tree[1] as TreeFolder;
		expect(user.prefix).toBe("user:");
		expect(user.count).toBe(3);
		// `user:2` is both a key and the folder holding `user:2:profile`.
		expect(user.children.map((n) => `${n.kind}:${n.label}`)).toEqual([
			"folder:2",
			"key:2",
			"key:10",
		]);
		expect((user.children[0] as TreeFolder).prefix).toBe("user:2:");
	});

	test("keeps empty segments visible", () => {
		const tree = buildTree([entry("a::b"), entry(":lead")]);
		expect(tree.map((n) => n.label)).toEqual(["", "a"]);
		const a = tree[1] as TreeFolder;
		expect(a.children[0].kind).toBe("folder");
		expect((a.children[0] as TreeFolder).prefix).toBe("a::");
	});

	test("respects a custom delimiter, or none", () => {
		expect(buildTree([entry("a/b"), entry("a/c")], "/")[0].label).toBe("a");
		expect(buildTree([entry("a:b")], "").map((n) => n.kind)).toEqual(["key"]);
	});

	test("counts keys at every level", () => {
		const tree = buildTree(["a:b:c", "a:b:d", "a:e"].map((n) => entry(n)));
		const a = tree[0] as TreeFolder;
		expect(a.count).toBe(3);
		expect((a.children[0] as TreeFolder).count).toBe(2);
	});
});

describe("visibleRows", () => {
	test("flattens only expanded folders, tracking depth", () => {
		const tree = buildTree(["a:1", "a:2", "b:1", "c"].map((n) => entry(n)));
		expect(visibleRows(tree, new Set()).map((r) => r.node.label)).toEqual(["a", "b", "c"]);
		const rows = visibleRows(tree, new Set(["a:"]));
		expect(rows.map((r) => [r.node.label, r.depth])).toEqual([
			["a", 0],
			["1", 1],
			["2", 1],
			["b", 0],
			["c", 0],
		]);
		expect(rows[0].expanded).toBe(true);
	});
});

describe("groupKeyPatterns", () => {
	test("collapses id-like segments and groups by type", () => {
		const groups = groupKeyPatterns([
			{ name: "user:1", type: "hash" },
			{ name: "user:2", type: "hash" },
			{ name: "user:3:sessions", type: "set" },
			{ name: "session:9f1c2a7be03d4c55a1b2c3d4e5f60718", type: "string" },
			{ name: "config", type: "string" },
		]);
		expect(groups[0]).toEqual({ pattern: "user:*", type: "hash", count: 2, example: "user:1" });
		expect(groups.map((g) => g.pattern)).toContain("session:*");
		expect(groups.map((g) => g.pattern)).toContain("user:*:sessions");
		expect(groups.map((g) => g.pattern)).toContain("config");
	});

	test("recognises ids but not words", () => {
		expect(looksLikeId("42")).toBe(true);
		expect(looksLikeId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
		expect(looksLikeId("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
		expect(looksLikeId("profile")).toBe(false);
		expect(looksLikeId("leaderboard")).toBe(false);
	});
});

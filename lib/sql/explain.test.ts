import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePlan, type PlanNode } from "./explain";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

function flatten(node: PlanNode): PlanNode[] {
	return [node, ...node.children.flatMap(flatten)];
}

describe("normalizePlan", () => {
	test("Postgres JSON plan", () => {
		const tree = normalizePlan("pg-json", JSON.parse(fixture("pg-plan.json")));
		expect(tree.analyzed).toBe(false);
		expect(tree.root.label).toBe("Limit");
		const labels = flatten(tree.root).map((n) => n.label);
		expect(labels).toContain("Nested Loop");
		expect(flatten(tree.root).some((n) => n.target?.includes("orders"))).toBe(true);
		const shares = flatten(tree.root).reduce((sum, n) => sum + n.share, 0);
		expect(shares).toBeCloseTo(1, 5);
	});

	test("Postgres ANALYZE plan carries actual rows and timings", () => {
		const tree = normalizePlan("pg-json", JSON.parse(fixture("pg-analyze.json")));
		expect(tree.analyzed).toBe(true);
		expect(tree.executionMs).toBeGreaterThan(0);
		expect(tree.root.actualRows).toBe(20);
		expect(flatten(tree.root).every((n) => n.selfTimeMs !== undefined)).toBe(true);
	});

	test("Postgres: the expensive node is the hot one, and seq scans are flagged", () => {
		const plan = [
			{
				Plan: {
					"Node Type": "Hash Join",
					"Join Type": "Inner",
					"Total Cost": 100,
					"Plan Rows": 5000,
					Plans: [
						{
							"Node Type": "Seq Scan",
							"Relation Name": "orders",
							Alias: "o",
							"Total Cost": 80,
							"Plan Rows": 5000,
						},
						{
							"Node Type": "Hash",
							"Total Cost": 10,
							"Plan Rows": 200,
							Plans: [
								{
									"Node Type": "Seq Scan",
									"Relation Name": "customers",
									"Total Cost": 8,
									"Plan Rows": 200,
								},
							],
						},
					],
				},
			},
		];
		const tree = normalizePlan("pg-json", plan);
		const scan = flatten(tree.root).find((n) => n.target === "orders o");
		expect(scan?.heat).toBe("hot");
		expect(scan?.warnings).toContain("Sequential scan over many rows");
		expect(tree.root.selfCost).toBe(10);
	});

	test("MySQL JSON plan", () => {
		const tree = normalizePlan("mysql-json", fixture("mysql-plan.json"));
		const nodes = flatten(tree.root);
		expect(tree.totalCost).toBeCloseTo(99.6);
		expect(nodes.some((n) => n.label === "Index lookup" && n.target?.startsWith("o "))).toBe(true);
		expect(nodes.some((n) => n.label === "Unique index lookup")).toBe(true);
		expect(nodes.find((n) => n.label === "Unique index lookup")?.heat).toBe("hot");
	});

	test("MySQL EXPLAIN ANALYZE tree", () => {
		const tree = normalizePlan("mysql-tree", fixture("mysql-analyze.txt"));
		expect(tree.analyzed).toBe(true);
		expect(tree.root.label).toBe("Limit: 20 row(s)");
		expect(tree.root.children[0].label).toBe("Nested loop inner join");
		expect(tree.root.children[0].children).toHaveLength(2);
		const lookup = tree.root.children[0].children[1];
		expect(lookup.loops).toBe(20);
		expect(lookup.target).toContain("using PRIMARY");
	});

	test("MariaDB plain and ANALYZE plans", () => {
		const plain = normalizePlan("mariadb-json", fixture("mariadb-plan.json"));
		expect(plain.analyzed).toBe(false);
		expect(flatten(plain.root).filter((n) => n.target).length).toBe(2);
		const analyzed = normalizePlan("mariadb-json", fixture("mariadb-analyze.json"));
		expect(analyzed.analyzed).toBe(true);
		expect(flatten(analyzed.root).some((n) => n.actualRows === 20)).toBe(true);
	});

	test("full table scans are flagged in MySQL", () => {
		const tree = normalizePlan("mysql-json", {
			query_block: {
				cost_info: { query_cost: "120.5" },
				table: {
					table_name: "orders",
					access_type: "ALL",
					rows_examined_per_scan: 1200,
					cost_info: { read_cost: "100", eval_cost: "20.5", prefix_cost: "120.5" },
					attached_condition: "(`orders`.`total` > 100)",
				},
			},
		});
		expect(tree.root.label).toBe("Full table scan");
		expect(tree.root.warnings[0]).toContain("Full table scan");
		expect(tree.root.details).toContainEqual(["Condition", "(`orders`.`total` > 100)"]);
	});

	test("libSQL EXPLAIN QUERY PLAN", () => {
		const tree = normalizePlan("sqlite-qp", JSON.parse(fixture("libsql-plan.json")));
		expect(tree.root.label).toBe("Query plan");
		expect(tree.root.children.map((n) => n.label)).toEqual(["Search", "Search"]);
		const scan = normalizePlan("sqlite-qp", [
			[2, 0, 0, "SCAN orders"],
			[9, 0, 0, "USE TEMP B-TREE FOR ORDER BY"],
		]);
		expect(scan.root.children[0].warnings).toContain("Full scan");
		expect(scan.root.children[1].label).toBe("Temporary B-tree");
	});
});

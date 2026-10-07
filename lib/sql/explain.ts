import type { SqlEngine } from "./types";

/**
 * Turns each engine's EXPLAIN output into one tree shape the console can draw:
 *
 *   postgres  EXPLAIN (FORMAT JSON [, ANALYZE, BUFFERS])
 *   mysql     EXPLAIN FORMAT=JSON, or EXPLAIN ANALYZE (a text tree)
 *   mariadb   EXPLAIN FORMAT=JSON, or ANALYZE FORMAT=JSON
 *   libsql    EXPLAIN QUERY PLAN (id, parent, notused, detail rows)
 *
 * Every node carries the engine's own words for what it does, its estimated and (when
 * analysed) actual rows, and a *self* cost or time: the part of the work this node does
 * that its children do not. The share of that self figure across the plan is what marks
 * a node as expensive, because a cumulative cost would always crown the root.
 */

export type PlanFormat = "pg-json" | "mysql-json" | "mysql-tree" | "mariadb-json" | "sqlite-qp";

export interface PlanNode {
	id: string;
	/** What the node does, e.g. "Seq Scan", "Hash Join", "Full table scan". */
	label: string;
	/** The object it works on, e.g. "orders o" or "using orders_pkey". */
	target?: string;
	/** Conditions, keys and other details, as the engine phrased them. */
	details: [string, string][];
	estimatedRows?: number;
	actualRows?: number;
	loops?: number;
	/** Cumulative cost as the engine reports it (Postgres/MySQL units). */
	cost?: number;
	/** Cost of this node alone. */
	selfCost?: number;
	/** Inclusive actual time across all loops, in ms. */
	timeMs?: number;
	/** Exclusive actual time across all loops, in ms. */
	selfTimeMs?: number;
	/** Share of the plan's total self cost (or self time when analysed), 0..1. */
	share: number;
	heat: "hot" | "warm" | "cool";
	warnings: string[];
	children: PlanNode[];
}

export interface PlanTree {
	format: PlanFormat;
	analyzed: boolean;
	root: PlanNode;
	totalCost?: number;
	planningMs?: number;
	executionMs?: number;
	/** Engine-reported nodes; used for the "N nodes" summary and tests. */
	nodeCount: number;
}

const num = (value: unknown): number | undefined => {
	if (value === null || value === undefined || value === "") return undefined;
	const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
	return Number.isFinite(n) ? n : undefined;
};

let counter = 0;
const nextId = () => `n${++counter}`;

function node(label: string, partial: Partial<PlanNode> = {}): PlanNode {
	return {
		id: nextId(),
		label,
		details: [],
		share: 0,
		heat: "cool",
		warnings: [],
		children: [],
		...partial,
	};
}

/* ------------------------------------------------------------------ *
 * Postgres
 * ------------------------------------------------------------------ */

const PG_DETAIL_KEYS = [
	"Index Cond",
	"Recheck Cond",
	"Filter",
	"Join Filter",
	"Hash Cond",
	"Merge Cond",
	"Sort Key",
	"Group Key",
	"Rows Removed by Filter",
	"Rows Removed by Join Filter",
	"Sort Method",
	"Sort Space Used",
	"Strategy",
	"Scan Direction",
	"Shared Hit Blocks",
	"Shared Read Blocks",
	"Workers Planned",
	"Subplan Name",
	"CTE Name",
	"Function Name",
];

function pgNode(plan: Record<string, unknown>, analyzed: boolean): PlanNode {
	const type = String(plan["Node Type"] ?? "Node");
	const joinType = plan["Join Type"] ? String(plan["Join Type"]) : null;
	const label =
		joinType && joinType !== "Inner" && /Join|Nested Loop/.test(type)
			? `${type} (${joinType.toLowerCase()})`
			: type;
	const relation = plan["Relation Name"]
		? `${plan.Schema ? `${plan.Schema}.` : ""}${plan["Relation Name"]}${
				plan.Alias && plan.Alias !== plan["Relation Name"] ? ` ${plan.Alias}` : ""
			}`
		: undefined;
	const index = plan["Index Name"] ? `using ${plan["Index Name"]}` : undefined;
	const loops = num(plan["Actual Loops"]) ?? 1;
	const result = node(label, {
		target: [relation, index].filter(Boolean).join(" ") || undefined,
		estimatedRows: num(plan["Plan Rows"]),
		actualRows: analyzed ? num(plan["Actual Rows"]) : undefined,
		loops: analyzed ? loops : undefined,
		cost: num(plan["Total Cost"]),
		timeMs: analyzed ? (num(plan["Actual Total Time"]) ?? 0) * loops : undefined,
	});
	for (const key of PG_DETAIL_KEYS) {
		const value = plan[key];
		if (value === undefined || value === null || value === 0 || value === "") continue;
		result.details.push([key, Array.isArray(value) ? value.join(", ") : String(value)]);
	}
	const children = Array.isArray(plan.Plans) ? (plan.Plans as Record<string, unknown>[]) : [];
	result.children = children.map((child) => pgNode(child, analyzed));

	if (type === "Seq Scan" && (result.actualRows ?? result.estimatedRows ?? 0) >= 1000) {
		result.warnings.push("Sequential scan over many rows");
	}
	if (
		num(plan["Rows Removed by Filter"]) &&
		(num(plan["Rows Removed by Filter"]) ?? 0) > (result.actualRows ?? 0) * 10
	) {
		result.warnings.push("Filter discards most rows it reads");
	}
	if (String(plan["Sort Method"] ?? "").includes("external"))
		result.warnings.push("Sort spilled to disk");
	return result;
}

function fromPostgres(raw: unknown): PlanTree {
	const top = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;
	const plan = top?.Plan as Record<string, unknown> | undefined;
	if (!plan) throw new Error("Unrecognised Postgres plan");
	const analyzed = "Actual Total Time" in plan || "Execution Time" in top;
	const root = pgNode(plan, analyzed);
	return finish({
		format: "pg-json",
		analyzed,
		root,
		totalCost: num(plan["Total Cost"]),
		planningMs: num(top["Planning Time"]),
		executionMs: num(top["Execution Time"]),
	});
}

/* ------------------------------------------------------------------ *
 * MySQL / MariaDB JSON
 * ------------------------------------------------------------------ */

const ACCESS: Record<string, string> = {
	ALL: "Full table scan",
	index: "Full index scan",
	range: "Index range scan",
	ref: "Index lookup",
	eq_ref: "Unique index lookup",
	ref_or_null: "Index lookup (or NULL)",
	const: "Constant row",
	system: "Single-row table",
	fulltext: "Full-text index",
	index_merge: "Index merge",
	unique_subquery: "Unique subquery",
	index_subquery: "Index subquery",
};

const OPERATIONS: Record<string, string> = {
	query_block: "Query block",
	ordering_operation: "Order",
	grouping_operation: "Group",
	duplicates_removal: "Remove duplicates",
	windowing: "Window",
	nested_loop: "Nested loop",
	union_result: "Union",
	materialized_from_subquery: "Materialize subquery",
	attached_subqueries: "Subquery",
	optimized_away_subqueries: "Subquery (optimised away)",
	subqueries: "Subquery",
	filesort: "Sort",
	temporary_table: "Temporary table",
	read_sorted_file: "Read sorted file",
	query_specifications: "Query",
	having_subqueries: "HAVING subquery",
	select_list_subqueries: "Select-list subquery",
	update_value_subqueries: "Update subquery",
	block_nl_join: "Block nested loop",
};

function mysqlTable(table: Record<string, unknown>, mariadb: boolean, analyzed: boolean): PlanNode {
	const access = String(table.access_type ?? "");
	const label = ACCESS[access] ?? (access ? `Access: ${access}` : "Table");
	const name = String(table.table_name ?? "");
	const key = table.key ? `using ${table.key}` : undefined;
	const costInfo = (table.cost_info ?? {}) as Record<string, unknown>;
	const selfCost = mariadb
		? num(table.cost)
		: (num(costInfo.read_cost) ?? 0) + (num(costInfo.eval_cost) ?? 0) || undefined;
	const result = node(label, {
		target: [name, key].filter(Boolean).join(" ") || undefined,
		estimatedRows: num(table.rows_examined_per_scan ?? table.rows),
		actualRows: analyzed ? num(table.r_rows) : undefined,
		loops: analyzed ? num(table.r_loops) : num(table.loops),
		cost: mariadb ? num(table.cost) : num(costInfo.prefix_cost),
		selfCost,
		selfTimeMs: analyzed
			? (num(table.r_table_time_ms) ?? 0) + (num(table.r_other_time_ms) ?? 0)
			: undefined,
	});
	for (const [k, label] of [
		["attached_condition", "Condition"],
		["index_condition", "Index condition"],
		["used_key_parts", "Key parts"],
		["ref", "Ref"],
		["filtered", "Filtered %"],
		["possible_keys", "Possible keys"],
	] as const) {
		const value = table[k];
		if (value === undefined || value === null) continue;
		result.details.push([label, Array.isArray(value) ? value.join(", ") : String(value)]);
	}
	if (table.using_index) result.details.push(["Covering index", "yes"]);
	if (access === "ALL" && (result.estimatedRows ?? 0) >= 1000) {
		result.warnings.push("Full table scan over many rows");
	} else if (access === "ALL") {
		result.warnings.push("Full table scan");
	}
	result.children = mysqlChildren(table, mariadb, analyzed);
	return result;
}

function mysqlChildren(
	obj: Record<string, unknown>,
	mariadb: boolean,
	analyzed: boolean,
): PlanNode[] {
	const children: PlanNode[] = [];
	for (const [key, value] of Object.entries(obj)) {
		if (key === "table" && value && typeof value === "object") {
			children.push(mysqlTable(value as Record<string, unknown>, mariadb, analyzed));
			continue;
		}
		if (!(key in OPERATIONS) || !value || typeof value !== "object") continue;
		if (Array.isArray(value)) {
			const items = value.map((item) => {
				const entry = item as Record<string, unknown>;
				if (entry.table)
					return mysqlTable(entry.table as Record<string, unknown>, mariadb, analyzed);
				if (entry.query_block)
					return mysqlOperation(
						"query_block",
						entry.query_block as Record<string, unknown>,
						mariadb,
						analyzed,
					);
				return mysqlOperation(key, entry, mariadb, analyzed);
			});
			// A nested loop is the join itself: show it as one node over its tables.
			if (key === "nested_loop" || items.length > 1) {
				children.push(node(OPERATIONS[key], { children: items }));
			} else children.push(...items);
		} else {
			children.push(mysqlOperation(key, value as Record<string, unknown>, mariadb, analyzed));
		}
	}
	return children;
}

function mysqlOperation(
	key: string,
	obj: Record<string, unknown>,
	mariadb: boolean,
	analyzed: boolean,
): PlanNode {
	const result = node(OPERATIONS[key] ?? key, {
		loops: analyzed ? num(obj.r_loops) : undefined,
		timeMs: analyzed ? num(obj.r_total_time_ms) : undefined,
	});
	if (obj.using_filesort) {
		result.label = "Sort";
		result.warnings.push("Filesort");
	}
	if (obj.using_temporary_table) result.warnings.push("Uses a temporary table");
	if (key === "filesort" && obj.sort_key) result.details.push(["Sort key", String(obj.sort_key)]);
	if (obj.select_id !== undefined) result.details.push(["Select", String(obj.select_id)]);
	result.children = mysqlChildren(obj, mariadb, analyzed);
	return result;
}

function fromMysqlJson(raw: unknown, mariadb: boolean): PlanTree {
	const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
	const block = parsed?.query_block as Record<string, unknown> | undefined;
	if (!block) throw new Error("Unrecognised MySQL plan");
	const analyzed = mariadb && ("r_loops" in block || "r_total_time_ms" in block);
	const root = mysqlOperation("query_block", block, mariadb, analyzed);
	const costInfo = (block.cost_info ?? {}) as Record<string, unknown>;
	const total = mariadb ? num(block.cost) : num(costInfo.query_cost);
	root.cost = total;
	// A single child under the query block is the plan; the block itself adds nothing.
	const collapsed =
		root.children.length === 1 && !root.warnings.length ? { ...root.children[0] } : root;
	if (collapsed !== root && collapsed.cost === undefined) collapsed.cost = total;
	return finish({
		format: mariadb ? "mariadb-json" : "mysql-json",
		analyzed,
		root: collapsed,
		totalCost: total,
		executionMs: analyzed ? num(block.r_total_time_ms) : undefined,
	});
}

/* ------------------------------------------------------------------ *
 * MySQL EXPLAIN ANALYZE (tree text)
 * ------------------------------------------------------------------ */

function fromMysqlTree(raw: unknown): PlanTree {
	const text = String(raw ?? "");
	const stack: { depth: number; node: PlanNode }[] = [];
	let root: PlanNode | null = null;
	for (const line of text.split("\n")) {
		const match = /^(\s*)-> (.*)$/.exec(line);
		if (!match) continue;
		const depth = match[1].length;
		const body = match[2];
		const cut = body.search(/\s{2}\(|\s\(cost=|\s\(actual/);
		const description = (cut === -1 ? body : body.slice(0, cut)).trim();
		const estimate = /\(cost=([\d.e+]+)(?:\.\.([\d.e+]+))? rows=([\d.e+]+)\)/.exec(body);
		const actual = /\(actual time=([\d.e+]+)\.\.([\d.e+]+) rows=([\d.e+]+) loops=(\d+)\)/.exec(
			body,
		);
		const loops = actual ? Number(actual[4]) : undefined;
		const [label, ...rest] = description.split(/ (?=on |using )/);
		const current = node(label, {
			target: rest.join(" ") || undefined,
			cost: estimate ? Number(estimate[2] ?? estimate[1]) : undefined,
			estimatedRows: estimate ? Number(estimate[3]) : undefined,
			actualRows: actual ? Number(actual[3]) : undefined,
			loops,
			timeMs: actual ? Number(actual[2]) * (loops ?? 1) : undefined,
		});
		if (/^Table scan/.test(description)) current.warnings.push("Full table scan");
		if (/^Sort/.test(description) && !/index/i.test(description))
			current.details.push(["Sort", description.replace(/^Sort:?\s*/, "")]);
		while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
		if (stack.length) stack[stack.length - 1].node.children.push(current);
		else root = current;
		stack.push({ depth, node: current });
	}
	if (!root) throw new Error("Unrecognised EXPLAIN ANALYZE output");
	return finish({
		format: "mysql-tree",
		analyzed: true,
		root,
		totalCost: root.cost,
		executionMs: root.timeMs,
	});
}

/* ------------------------------------------------------------------ *
 * SQLite / libSQL EXPLAIN QUERY PLAN
 * ------------------------------------------------------------------ */

function fromSqlite(raw: unknown): PlanTree {
	const rows = (Array.isArray(raw) ? raw : []) as unknown[][];
	const byId = new Map<number, PlanNode>();
	const root = node("Query plan");
	for (const row of rows) {
		const [id, parent, , detail] = row;
		const text = String(detail ?? "");
		const match =
			/^(SCAN|SEARCH|USE TEMP B-TREE|CORRELATED SCALAR SUBQUERY|SCALAR SUBQUERY|MATERIALIZE|CO-ROUTINE|COMPOUND QUERY|LEFT-MOST SUBQUERY|UNION ALL|MULTI-INDEX OR|INDEX)\s*(.*)$/.exec(
				text,
			);
		const current = node(match ? match[1] : text, {
			target: match?.[2] || undefined,
		});
		current.label =
			{
				SCAN: "Scan",
				SEARCH: "Search",
				"USE TEMP B-TREE": "Temporary B-tree",
			}[current.label] ?? current.label.charAt(0) + current.label.slice(1).toLowerCase();
		if (/^SCAN /.test(text) && !/COVERING INDEX|USING INDEX/.test(text)) {
			current.warnings.push("Full scan");
		}
		if (/^USE TEMP B-TREE/.test(text))
			current.warnings.push("Sorts or groups in a temporary B-tree");
		byId.set(Number(id), current);
		(byId.get(Number(parent)) ?? root).children.push(current);
	}
	const hasSingle = root.children.length === 1;
	return finish({
		format: "sqlite-qp",
		analyzed: false,
		root: hasSingle ? root.children[0] : root,
	});
}

/* ------------------------------------------------------------------ *
 * Shared post-processing
 * ------------------------------------------------------------------ */

function finish(tree: Omit<PlanTree, "nodeCount">): PlanTree {
	const nodes: PlanNode[] = [];
	// Under a LIMIT, steps stop early by design, so reading fewer rows than estimated is
	// expected rather than a sign of bad statistics.
	const limited = new Set<PlanNode>();
	const walk = (n: PlanNode, underLimit: boolean) => {
		nodes.push(n);
		if (underLimit) limited.add(n);
		const limits = underLimit || n.label.toLowerCase().startsWith("limit");
		for (const child of n.children) walk(child, limits);
	};
	walk(tree.root, false);

	for (const n of nodes) {
		// Derive self cost and self time from cumulative figures where the engine gave those.
		if (
			n.selfCost === undefined &&
			n.cost !== undefined &&
			tree.format !== "mysql-json" &&
			tree.format !== "mariadb-json"
		) {
			const childCost = n.children.reduce((sum, c) => sum + (c.cost ?? 0), 0);
			n.selfCost = Math.max(0, n.cost - childCost);
		}
		if (n.selfTimeMs === undefined && n.timeMs !== undefined) {
			const childTime = n.children.reduce((sum, c) => sum + (c.timeMs ?? 0), 0);
			n.selfTimeMs = Math.max(0, n.timeMs - childTime);
		}
		if (
			tree.analyzed &&
			n.actualRows !== undefined &&
			n.estimatedRows !== undefined &&
			n.estimatedRows > 0 &&
			(n.actualRows > n.estimatedRows * 10 ||
				(n.actualRows * 10 < n.estimatedRows && !limited.has(n))) &&
			Math.abs(n.actualRows - n.estimatedRows) > 100
		) {
			n.warnings.push(
				`Row estimate off: expected ${formatCount(n.estimatedRows)}, got ${formatCount(n.actualRows)}`,
			);
		}
	}

	const useTime = tree.analyzed && nodes.some((n) => (n.selfTimeMs ?? 0) > 0);
	const weight = (n: PlanNode) => (useTime ? (n.selfTimeMs ?? 0) : (n.selfCost ?? 0));
	const total = nodes.reduce((sum, n) => sum + weight(n), 0);
	for (const n of nodes) {
		n.share = total > 0 ? weight(n) / total : 0;
		n.heat = n.share >= 0.3 ? "hot" : n.share >= 0.1 ? "warm" : "cool";
	}
	return { ...tree, nodeCount: nodes.length };
}

export function formatCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 10_000) return `${Math.round(n / 1000)}k`;
	return String(Math.round(n * 100) / 100);
}

export function normalizePlan(format: PlanFormat, raw: unknown): PlanTree {
	counter = 0;
	switch (format) {
		case "pg-json":
			return fromPostgres(typeof raw === "string" ? JSON.parse(raw) : raw);
		case "mysql-json":
			return fromMysqlJson(raw, false);
		case "mariadb-json":
			return fromMysqlJson(raw, true);
		case "mysql-tree":
			return fromMysqlTree(raw);
		case "sqlite-qp":
			return fromSqlite(raw);
	}
}

/** Which plan format an engine produces, with or without ANALYZE. */
export function planFormat(engine: SqlEngine, analyze: boolean): PlanFormat {
	if (engine === "postgres") return "pg-json";
	if (engine === "libsql") return "sqlite-qp";
	if (engine === "mysql") return analyze ? "mysql-tree" : "mysql-json";
	return "mariadb-json";
}

/** Whether the engine can run the statement to report actual rows and timings. */
export function supportsAnalyze(engine: SqlEngine): boolean {
	return engine !== "libsql";
}

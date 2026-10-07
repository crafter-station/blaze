/**
 * Keys grouped into a namespace tree on a delimiter (`:` by convention), the way
 * RedisInsight and most Redis GUIs present a keyspace: `user:42:profile` lives under
 * `user` > `42`. Pure, so the browser can rebuild it on every page of keys it loads.
 */

export interface KeyEntry {
	/** Key reference as transported (see keys.ts). */
	key: string;
	/** Display form of the key. */
	name: string;
	type: string;
	/** Milliseconds; -1 = no expiry, -2 = gone. */
	ttl: number;
}

export interface TreeFolder {
	kind: "folder";
	/** Full prefix including the trailing delimiter, e.g. `user:42:`. */
	prefix: string;
	/** Last segment, e.g. `42`. */
	label: string;
	/** Keys anywhere below. */
	count: number;
	children: TreeNode[];
}

export interface TreeLeaf {
	kind: "key";
	label: string;
	entry: KeyEntry;
}

export type TreeNode = TreeFolder | TreeLeaf;

interface Building {
	folders: Map<string, Building & { label: string; prefix: string }>;
	keys: TreeLeaf[];
	count: number;
}

/**
 * Build the tree. A key that is itself a prefix of others (`user` and `user:1`) appears
 * both as a leaf and as a folder, as it would in the keyspace.
 */
export function buildTree(entries: KeyEntry[], delimiter = ":"): TreeNode[] {
	const root: Building = { folders: new Map(), keys: [], count: 0 };

	for (const entry of entries) {
		const parts = delimiter ? entry.name.split(delimiter) : [entry.name];
		let node = root;
		node.count++;
		let prefix = "";
		// Every segment but the last is a folder. Empty segments (`a::b`) are folders too,
		// labelled so they stay visible.
		for (let i = 0; i < parts.length - 1; i++) {
			prefix += parts[i] + delimiter;
			let next = node.folders.get(parts[i]);
			if (!next) {
				next = { folders: new Map(), keys: [], count: 0, label: parts[i], prefix };
				node.folders.set(parts[i], next);
			}
			next.count++;
			node = next;
		}
		node.keys.push({ kind: "key", label: parts[parts.length - 1], entry });
	}

	const finish = (node: Building): TreeNode[] => {
		const folders = [...node.folders.values()]
			.sort((a, b) => compareLabels(a.label, b.label))
			.map(
				(folder): TreeFolder => ({
					kind: "folder",
					prefix: folder.prefix,
					label: folder.label,
					count: folder.count,
					children: finish(folder),
				}),
			);
		const keys = [...node.keys].sort((a, b) => compareLabels(a.label, b.label));
		return [...folders, ...keys];
	};

	return finish(root);
}

/** Natural order, so `user:2` comes before `user:10`. */
export function compareLabels(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export interface VisibleRow {
	node: TreeNode;
	depth: number;
	/** Folder rows only. */
	expanded?: boolean;
}

/** Flatten the tree into the rows a virtualised list renders, honouring expansion. */
export function visibleRows(nodes: TreeNode[], expanded: Set<string>, depth = 0): VisibleRow[] {
	const rows: VisibleRow[] = [];
	for (const node of nodes) {
		if (node.kind === "folder") {
			const open = expanded.has(node.prefix);
			rows.push({ node, depth, expanded: open });
			if (open) rows.push(...visibleRows(node.children, expanded, depth + 1));
		} else {
			rows.push({ node, depth });
		}
	}
	return rows;
}

/**
 * Collapse sampled key names into patterns, for the assistant's context: segments that
 * look like ids (numbers, UUIDs, long hex, ULIDs) become `*`, so 200 `user:<n>` keys read
 * as one `user:*` line. Only names and types go in; never values.
 */
export function groupKeyPatterns(
	entries: { name: string; type: string }[],
	delimiter = ":",
): { pattern: string; type: string; count: number; example: string }[] {
	const groups = new Map<
		string,
		{ pattern: string; type: string; count: number; example: string }
	>();
	for (const entry of entries) {
		const pattern = entry.name
			.split(delimiter)
			.map((segment) => (looksLikeId(segment) ? "*" : segment))
			.join(delimiter);
		const id = `${pattern}\u0000${entry.type}`;
		const group = groups.get(id);
		if (group) group.count++;
		else groups.set(id, { pattern, type: entry.type, count: 1, example: entry.name });
	}
	return [...groups.values()].sort(
		(a, b) => b.count - a.count || compareLabels(a.pattern, b.pattern),
	);
}

export function looksLikeId(segment: string): boolean {
	return (
		/^\d+$/.test(segment) ||
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
		/^[0-9a-f]{12,}$/i.test(segment) ||
		/^[0-9A-HJKMNP-TV-Z]{26}$/.test(segment) ||
		// Mixed letters and digits of id-like length, e.g. session tokens.
		(segment.length >= 16 && /\d/.test(segment) && /^[A-Za-z0-9_-]+$/.test(segment))
	);
}

"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PIPELINE_STAGES, QUERY_OPERATORS, UPDATE_OPERATORS } from "@/lib/mongo/completion";

/**
 * What the shell understands, as a clickable list: each entry inserts a template into the
 * input. Kept to what the parser accepts, so nothing here fails to parse.
 */

interface Entry {
	label: string;
	template: string;
	summary: string;
}

export const REFERENCE: { title: string; entries: Entry[] }[] = [
	{
		title: "Read",
		entries: [
			{ label: "find", template: "db.<coll>.find({  })", summary: "Documents matching a filter" },
			{
				label: "findOne",
				template: "db.<coll>.findOne({  })",
				summary: "The first match, or null",
			},
			{
				label: "aggregate",
				template: "db.<coll>.aggregate([\n  { $match: {  } },\n])",
				summary: "Run a pipeline",
			},
			{
				label: "countDocuments",
				template: "db.<coll>.countDocuments({  })",
				summary: "Exact count",
			},
			{
				label: "estimatedDocumentCount",
				template: "db.<coll>.estimatedDocumentCount()",
				summary: "Fast count from metadata",
			},
			{
				label: "distinct",
				template: 'db.<coll>.distinct("field")',
				summary: "Unique values of a field",
			},
		],
	},
	{
		title: "Cursor",
		entries: [
			{ label: ".sort", template: ".sort({ field: -1 })", summary: "Order the results" },
			{ label: ".limit", template: ".limit(10)", summary: "At most n documents" },
			{ label: ".skip", template: ".skip(20)", summary: "Skip n documents" },
			{ label: ".project", template: ".project({ field: 1 })", summary: "Choose fields" },
			{ label: ".count", template: ".count()", summary: "Count the matches instead" },
		],
	},
	{
		title: "Write",
		entries: [
			{ label: "insertOne", template: "db.<coll>.insertOne({  })", summary: "Add a document" },
			{
				label: "insertMany",
				template: "db.<coll>.insertMany([{  }, {  }])",
				summary: "Add several",
			},
			{
				label: "updateOne",
				template: "db.<coll>.updateOne({  }, { $set: {  } })",
				summary: "Change the first match",
			},
			{
				label: "updateMany",
				template: "db.<coll>.updateMany({  }, { $set: {  } })",
				summary: "Change every match",
			},
			{
				label: "replaceOne",
				template: "db.<coll>.replaceOne({ _id:  }, {  })",
				summary: "Swap a whole document",
			},
			{
				label: "deleteOne",
				template: "db.<coll>.deleteOne({  })",
				summary: "Remove the first match",
			},
			{
				label: "deleteMany",
				template: "db.<coll>.deleteMany({  })",
				summary: "Remove every match",
			},
		],
	},
	{
		title: "Indexes and collections",
		entries: [
			{ label: "getIndexes", template: "db.<coll>.getIndexes()", summary: "List indexes" },
			{
				label: "createIndex",
				template: "db.<coll>.createIndex({ field: 1 })",
				summary: "Build an index",
			},
			{ label: "dropIndex", template: 'db.<coll>.dropIndex("name")', summary: "Remove an index" },
			{ label: "drop", template: "db.<coll>.drop()", summary: "Delete a collection" },
			{ label: "show collections", template: "show collections", summary: "List collections" },
			{
				label: "createCollection",
				template: 'db.createCollection("name")',
				summary: "Create a collection with options",
			},
			{ label: "stats", template: "db.stats()", summary: "Database size and counts" },
			{ label: "{ command }", template: "{ ping: 1 }", summary: "Any database command" },
		],
	},
	{
		title: "Query operators",
		entries: QUERY_OPERATORS.map((op) => ({ label: op, template: `${op}: `, summary: "" })),
	},
	{
		title: "Update operators",
		entries: UPDATE_OPERATORS.map((op) => ({ label: op, template: `${op}: `, summary: "" })),
	},
	{
		title: "Pipeline stages",
		entries: PIPELINE_STAGES.map((op) => ({ label: op, template: `{ ${op}:  }`, summary: "" })),
	},
];

export function MongoReference({
	collection,
	onPick,
}: {
	/** Substituted for `<coll>` in templates. */
	collection: string | null;
	onPick: (template: string) => void;
}) {
	const [query, setQuery] = useState("");
	const groups = useMemo(() => {
		const q = query.trim().toLowerCase();
		return REFERENCE.map((group) => ({
			...group,
			entries: q
				? group.entries.filter(
						(e) => e.label.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q),
					)
				: group.entries,
		})).filter((group) => group.entries.length);
	}, [query]);
	const ref = (template: string) =>
		template.replace(
			/db\.<coll>/g,
			collection
				? /^[A-Za-z_$][\w$]*$/.test(collection)
					? `db.${collection}`
					: `db.getCollection(${JSON.stringify(collection)})`
				: "db.collection",
		);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 p-2">
				<label className="relative block">
					<span className="sr-only">Filter the reference</span>
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Method or operator…"
						spellCheck={false}
						className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 font-mono text-[0.75rem] outline-none placeholder:font-sans placeholder:text-[0.8125rem] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
					/>
				</label>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto pb-3">
				{groups.map((group) => (
					<section key={group.title} aria-label={group.title}>
						<h3 className="px-3 pt-3 pb-1 font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wide">
							{group.title}
						</h3>
						<ul>
							{group.entries.map((entry) => (
								<li key={entry.label}>
									<button
										type="button"
										onClick={() => onPick(ref(entry.template))}
										title={ref(entry.template)}
										className="flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
									>
										<span className="shrink-0 font-mono text-[0.75rem]">{entry.label}</span>
										{entry.summary && (
											<span className="truncate text-muted-foreground text-xs">
												{entry.summary}
											</span>
										)}
									</button>
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</div>
	);
}

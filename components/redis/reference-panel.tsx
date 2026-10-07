"use client";

import { BookOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { ListEmpty, ListFilter, ListSkeleton } from "@/components/console-shell/library";
import { type CommandIndex, renderSyntax } from "@/lib/redis/commands";

/**
 * Every command the connected server documents, grouped as the Redis docs group them,
 * searchable by name or summary. Picking one puts it in the input with its syntax shown
 * as a hint; nothing runs.
 */

const GROUP_LABEL: Record<string, string> = {
	generic: "Keys",
	string: "Strings",
	list: "Lists",
	hash: "Hashes",
	set: "Sets",
	sorted_set: "Sorted sets",
	stream: "Streams",
	module: "Modules",
	server: "Server",
	connection: "Connection",
	scripting: "Scripting",
	transactions: "Transactions",
	pubsub: "Pub/Sub",
	geo: "Geo",
	hyperloglog: "HyperLogLog",
	bitmap: "Bitmaps",
	cluster: "Cluster",
	sentinel: "Sentinel",
};

const ORDER = ["generic", "string", "hash", "list", "set", "sorted_set", "stream", "module"];

export function ReferencePanel({
	index,
	error,
	onPick,
}: {
	index: CommandIndex | null;
	error: string | null;
	onPick: (name: string) => void;
}) {
	const [filter, setFilter] = useState("");
	const groups = useMemo(() => {
		if (!index) return [];
		const needle = filter.trim().toLowerCase();
		const byGroup = new Map<string, CommandIndex[string][]>();
		for (const spec of Object.values(index)) {
			// Subcommands are reached through their container (CLIENT → LIST).
			if (spec.name.includes(" ") || spec.deprecated) continue;
			if (
				needle &&
				!spec.name.toLowerCase().includes(needle) &&
				!(spec.summary ?? "").toLowerCase().includes(needle)
			) {
				continue;
			}
			const group = spec.module ? "module" : (spec.group ?? "other");
			byGroup.set(group, [...(byGroup.get(group) ?? []), spec]);
		}
		return [...byGroup.entries()]
			.sort(([a], [b]) => {
				const ia = ORDER.indexOf(a);
				const ib = ORDER.indexOf(b);
				return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
			})
			.map(([group, specs]) => ({
				group,
				specs: specs.sort((x, y) => x.name.localeCompare(y.name)),
			}));
	}, [index, filter]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ListFilter value={filter} onChange={setFilter} label="Find a command" />
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-3">
				{error ? (
					<p role="alert" className="px-3 py-4 text-destructive text-xs">
						{error}
					</p>
				) : !index ? (
					<ListSkeleton />
				) : groups.length === 0 ? (
					<ListEmpty icon={BookOpen} title="No commands match">
						Try part of the name, or a word from what it does.
					</ListEmpty>
				) : (
					groups.map(({ group, specs }) => (
						<section key={group} className="mb-2">
							<h3 className="sticky top-0 z-10 bg-sidebar px-2.5 pt-2 pb-1 font-medium text-[0.6875rem] text-muted-foreground">
								{GROUP_LABEL[group] ?? group.replace(/_/g, " ")}
								<span className="ml-1.5 tabular-nums opacity-70">{specs.length}</span>
							</h3>
							<ul className="space-y-px">
								{specs.map((spec) => (
									<li key={spec.name}>
										<button
											type="button"
											onClick={() => onPick(spec.name)}
											title={renderSyntax(spec)}
											className="block w-full rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
										>
											<span className="block truncate font-medium font-mono text-[0.75rem]">
												{spec.name}
											</span>
											{spec.summary && (
												<span className="mt-0.5 line-clamp-2 block text-[0.6875rem] text-muted-foreground leading-snug">
													{spec.summary}
												</span>
											)}
										</button>
									</li>
								))}
							</ul>
						</section>
					))
				)}
			</div>
		</div>
	);
}

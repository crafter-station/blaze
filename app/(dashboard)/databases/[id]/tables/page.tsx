import { ArrowLeft, ChevronLeft, ChevronRight, Table2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/dashboard/status-pill";
import { requireUser } from "@/lib/auth";
import { getOwnedDatabase } from "@/lib/provision";
import { listTables, PAGE_SIZE, readTablePage, type TableRef } from "@/lib/tables";
import { cn } from "@/lib/utils";

export const metadata = { title: "Tables" };
export const dynamic = "force-dynamic";

interface Search {
	schema?: string;
	table?: string;
	offset?: string;
}

export default async function TablesPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<Search>;
}) {
	const { id } = await params;
	const query = await searchParams;
	const user = await requireUser();

	const record = await getOwnedDatabase(user.id, id);
	if (!record) notFound();

	let tables: TableRef[] = [];
	let listError: string | null = null;
	try {
		tables = await listTables(record);
	} catch (error) {
		listError = error instanceof Error ? error.message : "Could not read the schema";
	}

	// Default to the first table so the page is never an empty frame asking you to pick.
	const selected =
		tables.find((t) => t.schema === query.schema && t.name === query.table) ?? tables[0] ?? null;

	const offset = Math.max(0, Number(query.offset ?? 0) || 0);
	const page = selected
		? await readTablePage(record, tables, selected.schema, selected.name, offset)
		: null;

	function href(table: TableRef, nextOffset = 0) {
		return `/databases/${id}/tables?schema=${encodeURIComponent(table.schema)}&table=${encodeURIComponent(table.name)}&offset=${nextOffset}`;
	}

	return (
		<div className="space-y-8">
			<div>
				<Link
					href={`/databases/${id}`}
					className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
				>
					<ArrowLeft className="size-3.5" />
					{record.name}
				</Link>
			</div>

			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex items-center gap-3">
					<h1 className="font-semibold text-[34px] leading-tight tracking-tight">Tables</h1>
					<StatusPill status={record.status} />
				</div>
			</div>

			{listError ? (
				<div className="rounded-xl border border-destructive/30 bg-destructive/5 px-7 py-5">
					<p className="font-medium text-destructive text-sm">Could not read the schema</p>
					<p className="mt-1.5 font-mono text-muted-foreground text-xs">{listError}</p>
				</div>
			) : tables.length === 0 ? (
				<section className="rounded-xl border border-border bg-card px-7 py-20 text-center">
					<Table2 className="mx-auto mb-4 size-8 text-muted-foreground/50" />
					<p className="font-medium">No tables yet</p>
					<p className="mx-auto mt-1.5 max-w-md text-muted-foreground text-sm">
						Create one from the{" "}
						<Link href={`/databases/${id}/sql`} className="text-foreground underline">
							SQL Editor
						</Link>{" "}
						and it will show up here.
					</p>
				</section>
			) : (
				<div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
					<aside className="rounded-xl border border-border bg-card p-2">
						{groupBySchema(tables).map(([schema, items]) => (
							<div key={schema} className="mb-2 last:mb-0">
								<p className="px-3 py-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
									{schema}
								</p>
								<div className="space-y-0.5">
									{items.map((table) => {
										const active =
											selected?.schema === table.schema && selected?.name === table.name;
										return (
											<Link
												key={`${table.schema}.${table.name}`}
												href={href(table)}
												className={cn(
													"flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
													active
														? "bg-accent font-medium text-foreground"
														: "text-muted-foreground hover:bg-accent hover:text-foreground",
												)}
											>
												<Table2 className="size-3.5 shrink-0" />
												<span className="truncate">{table.name}</span>
												{table.type === "view" && (
													<span className="ml-auto text-[10px] text-muted-foreground">view</span>
												)}
											</Link>
										);
									})}
								</div>
							</div>
						))}
					</aside>

					<section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
						{selected && page ? (
							<>
								<div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-5 py-3 text-xs">
									<p className="text-muted-foreground">
										<span className="font-mono text-foreground">
											{selected.schema}.{selected.name}
										</span>
										<span className="ml-3">
											{page.total} row{page.total === 1 ? "" : "s"}
										</span>
										<span className="ml-3 tabular-nums">{page.durationMs}ms</span>
									</p>
									<Pagination id={id} table={selected} page={page} href={href} />
								</div>

								{page.rows.length === 0 ? (
									<p className="px-5 py-16 text-center text-muted-foreground text-sm">
										This table is empty.
									</p>
								) : (
									<div className="max-h-[560px] overflow-auto">
										<table className="w-full text-left text-xs">
											<thead className="sticky top-0 bg-card">
												<tr className="border-border border-b">
													{page.columns.map((column) => (
														<th
															key={column.name}
															className="whitespace-nowrap px-4 py-2.5 font-medium"
														>
															{column.name}
															{/* Type beside the name, as in the reference — it is the
															    question you have most often when reading a grid. */}
															<span className="ml-2 font-normal text-[10px] text-muted-foreground">
																{column.type}
																{column.isPrimaryKey && " · pk"}
															</span>
														</th>
													))}
												</tr>
											</thead>
											<tbody className="divide-y divide-border">
												{page.rows.map((row, rowIndex) => (
													// Rows have no stable identity here; index is all there is.
													<tr key={rowIndex} className="hover:bg-accent/40">
														{row.map((cell, cellIndex) => (
															<td
																key={cellIndex}
																className={cn(
																	"max-w-[320px] truncate px-4 py-2 font-mono",
																	cell === null && "text-muted-foreground/50 italic",
																)}
																title={cell === null ? "NULL" : String(cell)}
															>
																{cell === null ? "NULL" : String(cell)}
															</td>
														))}
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
							</>
						) : (
							<p className="px-5 py-16 text-center text-muted-foreground text-sm">
								Select a table.
							</p>
						)}
					</section>
				</div>
			)}
		</div>
	);
}

function Pagination({
	table,
	page,
	href,
}: {
	id: string;
	table: TableRef;
	page: { total: number; offset: number };
	href: (table: TableRef, offset: number) => string;
}) {
	const from = page.total === 0 ? 0 : page.offset + 1;
	const to = Math.min(page.offset + PAGE_SIZE, page.total);
	const hasPrev = page.offset > 0;
	const hasNext = page.offset + PAGE_SIZE < page.total;

	return (
		<div className="flex items-center gap-3">
			<span className="text-muted-foreground tabular-nums">
				{from}–{to}
			</span>
			<div className="flex items-center gap-1">
				<PageLink
					href={href(table, Math.max(0, page.offset - PAGE_SIZE))}
					disabled={!hasPrev}
					label="Previous page"
				>
					<ChevronLeft className="size-3.5" />
				</PageLink>
				<PageLink href={href(table, page.offset + PAGE_SIZE)} disabled={!hasNext} label="Next page">
					<ChevronRight className="size-3.5" />
				</PageLink>
			</div>
		</div>
	);
}

function PageLink({
	href,
	disabled,
	label,
	children,
}: {
	href: string;
	disabled: boolean;
	label: string;
	children: React.ReactNode;
}) {
	if (disabled) {
		return (
			<span className="cursor-not-allowed rounded-md border border-border p-1.5 text-muted-foreground/35">
				{children}
			</span>
		);
	}
	return (
		<Link
			href={href}
			aria-label={label}
			className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		>
			{children}
		</Link>
	);
}

function groupBySchema(tables: TableRef[]): [string, TableRef[]][] {
	const groups = new Map<string, TableRef[]>();
	for (const table of tables) {
		const list = groups.get(table.schema) ?? [];
		list.push(table);
		groups.set(table.schema, list);
	}
	return [...groups.entries()];
}

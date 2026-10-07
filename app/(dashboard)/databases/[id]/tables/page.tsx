import { ChevronLeft, ChevronRight, CircleAlert, Eye, Table2 } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmptyState, PageHeader, Panel } from "@/components/console/page";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { ENGINE_CONFIG } from "@/lib/engines/types";
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
	// Redis has keys, not tables: its Browser takes this slot.
	if (record.engine === "redis") redirect(`/databases/${id}/browser`);

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

	const hasSql = ENGINE_CONFIG[record.engine].hasSql;

	return (
		<div className="space-y-8">
			<PageHeader
				back={{ href: `/databases/${id}`, label: record.name }}
				title="Tables"
				meta={<StatusPill status={record.status} />}
				description={
					tables.length > 0
						? `${tables.length} ${tables.length === 1 ? "relation" : "relations"} across ${groupBySchema(tables).length} ${groupBySchema(tables).length === 1 ? "schema" : "schemas"}`
						: undefined
				}
			/>

			{listError ? (
				<div
					role="alert"
					className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/[0.06] px-5 py-4"
				>
					<CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
					<div className="min-w-0">
						<p className="font-medium text-destructive text-sm">Could not read the schema</p>
						<p className="mt-1 break-words font-mono text-muted-foreground text-xs">{listError}</p>
					</div>
				</div>
			) : tables.length === 0 ? (
				<Panel>
					<EmptyState
						icon={Table2}
						title="No tables yet"
						description={
							hasSql ? (
								<>
									Create one from the{" "}
									<Link
										href={`/databases/${id}/sql`}
										className="text-foreground underline underline-offset-4"
									>
										SQL editor
									</Link>{" "}
									and it will show up here.
								</>
							) : (
								"Write some data with your client and it will show up here."
							)
						}
					/>
				</Panel>
			) : (
				<div className="grid gap-4 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-6">
					<aside
						aria-label="Tables"
						className="max-h-64 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-xs lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)]"
					>
						{groupBySchema(tables).map(([schema, items]) => (
							<div key={schema} className="mb-1.5 last:mb-0">
								<p className="px-2.5 pt-2 pb-1.5 font-medium font-mono text-[0.6875rem] text-muted-foreground">
									{schema}
								</p>
								<ul className="space-y-px">
									{items.map((table) => {
										const active =
											selected?.schema === table.schema && selected?.name === table.name;
										const Icon = table.type === "view" ? Eye : Table2;
										return (
											<li key={`${table.schema}.${table.name}`}>
												<Link
													href={href(table)}
													aria-current={active ? "page" : undefined}
													className={cn(
														"relative flex h-8 items-center gap-2 rounded-md px-2.5 text-[0.8125rem] transition-colors",
														active
															? "bg-accent font-medium text-foreground"
															: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
													)}
												>
													{active && (
														<span
															aria-hidden="true"
															className="absolute top-2 bottom-2 -left-1.5 w-[3px] rounded-r-full bg-brand"
														/>
													)}
													<Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
													<span className="truncate">{table.name}</span>
													{table.type === "view" && (
														<span className="ml-auto text-[0.625rem] text-muted-foreground">
															view
														</span>
													)}
												</Link>
											</li>
										);
									})}
								</ul>
							</div>
						))}
					</aside>

					<section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
						{selected && page ? (
							<>
								<div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-4 py-2.5 text-xs">
									<p className="flex min-w-0 items-center gap-3 text-muted-foreground">
										<span className="truncate font-mono text-foreground">
											{selected.schema}.{selected.name}
										</span>
										<span className="tabular-nums">
											{page.total} row{page.total === 1 ? "" : "s"}
										</span>
										<span className="font-mono tabular-nums">{page.durationMs}ms</span>
									</p>
									<Pagination table={selected} page={page} href={href} />
								</div>

								{page.rows.length === 0 ? (
									<p className="px-5 py-16 text-center text-muted-foreground text-sm">
										This table is empty.
									</p>
								) : (
									<div className="max-h-[600px] overflow-auto">
										<table className="w-full text-left text-xs">
											<thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--border)]">
												<tr>
													{page.columns.map((column) => (
														<th
															key={column.name}
															className="whitespace-nowrap px-4 py-2 font-medium"
														>
															{column.name}
															{/* Type beside the name: it is the question you have most
															    often when reading a grid. */}
															<span className="ml-2 font-mono font-normal text-[0.625rem] text-muted-foreground">
																{column.type}
																{column.isPrimaryKey && (
																	<span className="ml-1 text-brand-text">pk</span>
																)}
															</span>
														</th>
													))}
												</tr>
											</thead>
											<tbody className="divide-y divide-border">
												{page.rows.map((row, rowIndex) => (
													// Rows have no stable identity here; index is all there is.
													<tr key={rowIndex} className="transition-colors hover:bg-muted/50">
														{row.map((cell, cellIndex) => (
															<td
																key={cellIndex}
																className={cn(
																	"max-w-[320px] truncate px-4 py-2 font-mono",
																	cell === null && "text-muted-foreground/60 italic",
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
	table: TableRef;
	page: { total: number; offset: number };
	href: (table: TableRef, offset: number) => string;
}) {
	const from = page.total === 0 ? 0 : page.offset + 1;
	const to = Math.min(page.offset + PAGE_SIZE, page.total);
	const hasPrev = page.offset > 0;
	const hasNext = page.offset + PAGE_SIZE < page.total;

	return (
		<div className="flex items-center gap-2">
			<span className="text-muted-foreground tabular-nums">
				{from}-{to} of {page.total}
			</span>
			<div className="flex items-center gap-1">
				<PageLink
					href={href(table, Math.max(0, page.offset - PAGE_SIZE))}
					disabled={!hasPrev}
					label="Previous page"
				>
					<ChevronLeft />
				</PageLink>
				<PageLink href={href(table, page.offset + PAGE_SIZE)} disabled={!hasNext} label="Next page">
					<ChevronRight />
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
			<Button variant="outline" size="icon-xs" disabled aria-label={label}>
				{children}
			</Button>
		);
	}
	return (
		<Button variant="outline" size="icon-xs" asChild>
			<Link href={href} aria-label={label}>
				{children}
			</Link>
		</Button>
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

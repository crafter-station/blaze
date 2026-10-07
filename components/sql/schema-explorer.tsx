"use client";

import {
	ChevronRight,
	CircleAlert,
	Code2,
	Copy,
	Database,
	Eye,
	KeyRound,
	Link2,
	MoreHorizontal,
	Play,
	RefreshCw,
	Search,
	Table2,
	TableProperties,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { qualifiedName, quoteIdentifier } from "@/lib/sql/dialect";
import type { SchemaSnapshot, SchemaTable, SqlEngine } from "@/lib/sql/types";
import { cn } from "@/lib/utils";

/**
 * Schemas, tables and their columns, indexes and foreign keys, from the same snapshot that
 * powers autocomplete. Clicking a name inserts it at the cursor; the table menu (right
 * click, long press, or the ⋯ button for keyboard and touch) offers a preview query, the
 * DDL, and the table browser.
 */

export interface TableAction {
	selectStar(table: SchemaTable): void;
	viewDdl(table: SchemaTable): void;
	insert(text: string): void;
}

export function SchemaExplorer({
	databaseId,
	engine,
	snapshot,
	loading,
	error,
	onRefresh,
	actions,
	className,
}: {
	databaseId: string;
	engine: SqlEngine;
	snapshot: SchemaSnapshot | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
	actions: TableAction;
	className?: string;
}) {
	const [query, setQuery] = useState("");
	const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set());
	const [openTables, setOpenTables] = useState<Set<string>>(new Set());

	const groups = useMemo(() => {
		if (!snapshot) return [];
		const needle = query.trim().toLowerCase();
		return snapshot.schemas
			.map((schema) => ({
				schema,
				tables: snapshot.tables.filter(
					(t) =>
						t.schema === schema &&
						(!needle ||
							t.name.toLowerCase().includes(needle) ||
							t.columns.some((c) => c.name.toLowerCase().includes(needle))),
				),
			}))
			.filter((group) => !needle || group.tables.length > 0);
	}, [snapshot, query]);

	const tableCount = snapshot?.tables.length ?? 0;
	const multiSchema = (snapshot?.schemas.length ?? 0) > 1;

	function toggle<T>(set: Set<T>, value: T, update: (next: Set<T>) => void) {
		const next = new Set(set);
		if (next.has(value)) next.delete(value);
		else next.add(value);
		update(next);
	}

	return (
		<div className={cn("flex min-h-0 flex-col", className)}>
			<div className="flex shrink-0 items-center gap-1 p-2">
				<label className="relative block flex-1">
					<span className="sr-only">Filter tables and columns</span>
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Filter tables and columns…"
						spellCheck={false}
						autoComplete="off"
						className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 text-[0.8125rem] outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
					/>
				</label>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onRefresh}
					disabled={loading}
					aria-label={`Refresh schema${snapshot ? ` (${tableCount} tables)` : ""}`}
					title="Refresh schema"
				>
					<RefreshCw className={cn(loading && "animate-spin motion-reduce:animate-none")} />
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-3">
				{error ? (
					<div
						role="alert"
						className="mx-1.5 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-3"
					>
						<p className="flex items-center gap-1.5 font-medium text-destructive text-xs">
							<CircleAlert className="size-3.5" />
							Could not read the schema
						</p>
						<p className="mt-1 break-words font-mono text-[0.6875rem] text-muted-foreground">
							{error}
						</p>
						<Button variant="outline" size="xs" className="mt-2.5" onClick={onRefresh}>
							Try again
						</Button>
					</div>
				) : !snapshot ? (
					<ExplorerSkeleton />
				) : tableCount === 0 ? (
					<div className="px-3 py-8 text-center">
						<Database className="mx-auto size-5 text-muted-foreground" strokeWidth={1.5} />
						<p className="mt-2 font-medium text-[0.8125rem]">No tables yet</p>
						<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
							Run a CREATE TABLE and refresh to see it here.
						</p>
					</div>
				) : groups.length === 0 ? (
					<p className="px-3 py-6 text-center text-muted-foreground text-xs">
						Nothing matches “{query}”.
					</p>
				) : (
					<ul className="space-y-0.5">
						{groups.map(({ schema, tables }) => {
							const collapsed = collapsedSchemas.has(schema) && !query;
							return (
								<li key={schema}>
									{multiSchema && (
										<button
											type="button"
											aria-expanded={!collapsed}
											onClick={() => toggle(collapsedSchemas, schema, setCollapsedSchemas)}
											className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left font-medium font-mono text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
										>
											<ChevronRight
												className={cn("size-3 transition-transform", !collapsed && "rotate-90")}
											/>
											{schema}
											<span className="ml-auto font-sans tabular-nums">{tables.length}</span>
										</button>
									)}
									{!collapsed && (
										<ul className={cn("space-y-px", multiSchema && "pl-2")}>
											{tables.map((table) => {
												const key = `${table.schema}.${table.name}`;
												return (
													<TableNode
														key={key}
														table={table}
														open={
															openTables.has(key) ||
															(query.length > 0 && matchesColumn(table, query))
														}
														onToggle={() => toggle(openTables, key, setOpenTables)}
														engine={engine}
														defaultSchema={snapshot.defaultSchema}
														databaseId={databaseId}
														actions={actions}
													/>
												);
											})}
										</ul>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}

function matchesColumn(table: SchemaTable, query: string) {
	const needle = query.trim().toLowerCase();
	return (
		!table.name.toLowerCase().includes(needle) &&
		table.columns.some((c) => c.name.toLowerCase().includes(needle))
	);
}

function TableNode({
	table,
	open,
	onToggle,
	engine,
	defaultSchema,
	databaseId,
	actions,
}: {
	table: SchemaTable;
	open: boolean;
	onToggle: () => void;
	engine: SqlEngine;
	defaultSchema: string;
	databaseId: string;
	actions: TableAction;
}) {
	const Icon = table.kind === "view" ? Eye : Table2;
	const name = qualifiedName(engine, table.schema, table.name, defaultSchema);
	const browse = `/databases/${databaseId}/tables?schema=${encodeURIComponent(table.schema)}&table=${encodeURIComponent(table.name)}`;
	const items = [
		{
			label: "Preview rows",
			hint: "SELECT * … LIMIT 100",
			icon: Play,
			onSelect: () => actions.selectStar(table),
		},
		{ label: "View definition", hint: "DDL", icon: Code2, onSelect: () => actions.viewDdl(table) },
		{ label: "Insert name", icon: Copy, onSelect: () => actions.insert(name) },
	];

	return (
		<li>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div className="group/table flex h-7 items-center rounded-md transition-colors hover:bg-accent/60">
						<button
							type="button"
							aria-expanded={open}
							aria-label={`${open ? "Collapse" : "Expand"} ${table.name}`}
							onClick={onToggle}
							className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
						>
							<ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
						</button>
						<button
							type="button"
							onClick={() => actions.insert(name)}
							title={`Insert ${name}`}
							className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch rounded-md pr-1 text-left text-[0.8125rem] text-foreground/90 focus-visible:outline-2 focus-visible:outline-ring"
						>
							<Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
							<span className="truncate">{table.name}</span>
						</button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									aria-label={`Actions for ${table.name}`}
									className="mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/table:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
								>
									<MoreHorizontal className="size-3.5" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" side="right" className="min-w-48">
								<DropdownMenuLabel className="truncate font-mono text-xs">{name}</DropdownMenuLabel>
								{items.map((item) => (
									<DropdownMenuItem key={item.label} onSelect={item.onSelect}>
										<item.icon className="text-muted-foreground" />
										{item.label}
									</DropdownMenuItem>
								))}
								<DropdownMenuSeparator />
								<DropdownMenuItem asChild>
									<Link href={browse}>
										<TableProperties className="text-muted-foreground" />
										Open in Table browser
									</Link>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuLabel>{name}</ContextMenuLabel>
					{items.map((item) => (
						<ContextMenuItem key={item.label} onSelect={item.onSelect}>
							<item.icon />
							{item.label}
						</ContextMenuItem>
					))}
					<ContextMenuSeparator />
					<ContextMenuItem asChild>
						<Link href={browse}>
							<TableProperties />
							Open in Table browser
						</Link>
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{open && (
				<div className="mb-1.5 ml-[13px] border-border border-l pl-2">
					<ul>
						{table.columns.map((column) => (
							<li key={column.name}>
								<button
									type="button"
									onClick={() => actions.insert(quoteIdentifier(engine, column.name))}
									title={`${column.name} ${column.type}${column.nullable ? "" : " not null"}`}
									className="flex h-6 w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-xs transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
								>
									{column.isPrimaryKey ? (
										<KeyRound
											className="size-3 shrink-0 text-brand-text"
											aria-label="Primary key"
										/>
									) : (
										<span className="size-3 shrink-0" />
									)}
									<span className="truncate font-mono text-foreground/85">{column.name}</span>
									<span className="ml-auto flex shrink-0 items-center gap-1 pl-2 font-mono text-[0.6875rem] text-muted-foreground">
										<span className="max-w-[96px] truncate">{column.type.toLowerCase()}</span>
										{column.nullable && (
											<span className="text-muted-foreground/60" title="Nullable">
												?
											</span>
										)}
									</span>
								</button>
							</li>
						))}
					</ul>
					{table.indexes.length > 0 && (
						<Section title="Indexes">
							{table.indexes.map((index) => (
								<li
									key={index.name}
									className="flex h-6 items-center gap-1.5 px-1.5 text-xs"
									title={index.name}
								>
									<span className="truncate font-mono text-foreground/75">{index.name}</span>
									<span className="ml-auto shrink-0 pl-2 font-mono text-[0.6875rem] text-muted-foreground">
										{index.primary ? "pk" : index.unique ? "unique" : ""} (
										{index.columns.join(", ")})
									</span>
								</li>
							))}
						</Section>
					)}
					{table.foreignKeys.length > 0 && (
						<Section title="Foreign keys">
							{table.foreignKeys.map((fk) => (
								<li
									key={fk.name}
									className="flex h-6 items-center gap-1.5 px-1.5 text-xs"
									title={fk.name}
								>
									<Link2 className="size-3 shrink-0 text-muted-foreground" />
									<span className="truncate font-mono text-foreground/75">
										{fk.columns.join(", ")}
									</span>
									<span className="ml-auto shrink-0 truncate pl-2 font-mono text-[0.6875rem] text-muted-foreground">
										{fk.refTable}.{fk.refColumns.join(", ")}
									</span>
								</li>
							))}
						</Section>
					)}
				</div>
			)}
		</li>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="mt-1">
			<p className="px-1.5 pt-1 pb-0.5 text-[0.625rem] text-muted-foreground uppercase tracking-wider">
				{title}
			</p>
			<ul>{children}</ul>
		</div>
	);
}

function ExplorerSkeleton() {
	return (
		<div className="space-y-2 px-2 py-1" aria-hidden="true">
			{[68, 52, 74, 46, 60, 40].map((width, i) => (
				<div key={i} className="flex items-center gap-2">
					<div className="size-3.5 rounded-sm bg-foreground/[0.06]" />
					<div
						className="h-3 animate-pulse rounded bg-foreground/[0.06] motion-reduce:animate-none"
						style={{ width: `${width}%` }}
					/>
				</div>
			))}
		</div>
	);
}

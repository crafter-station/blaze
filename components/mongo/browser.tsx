"use client";

import {
	Braces,
	ChevronLeft,
	ChevronRight,
	ClipboardCopy,
	Database,
	FolderTree,
	KeyRound,
	Layers,
	Loader2,
	MoreHorizontal,
	Pencil,
	Play,
	Plus,
	RefreshCw,
	RotateCcw,
	Search,
	SlidersHorizontal,
	SquareTerminal,
	Table2,
	Trash2,
	X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	mongoCountAction,
	mongoCreateCollectionAction,
	mongoCreateIndexAction,
	mongoDeleteAction,
	mongoDropCollectionAction,
	mongoDropIndexAction,
	mongoFindAction,
	mongoIndexesAction,
	mongoInsertAction,
	mongoOverviewAction,
	mongoReplaceAction,
} from "@/app/(dashboard)/databases/[id]/browser/mongo-actions";
import { DataGrid } from "@/components/console-shell/data-grid";
import { useMediaQuery } from "@/components/console-shell/hooks";
import { SegmentedTabs } from "@/components/console-shell/tab-strip";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { formatBytes } from "@/lib/format";
import {
	bsonTypeOf,
	type EJsonValue,
	isObject,
	LiteralParseError,
	parseLiteral,
	toShell,
} from "@/lib/mongo/literal";
import { topLevelColumns } from "@/lib/mongo/schema";
import type { CollectionSummary, DatabaseOverview, FindPage, IndexInfo } from "@/lib/mongo/types";
import { cn } from "@/lib/utils";
import { CodeEditor } from "./code-editor";
import {
	ConfirmDialog,
	type ConfirmState,
	CreateCollectionDialog,
	CreateIndexDialog,
	DocumentDialog,
	describeParseError,
} from "./dialogs";
import { cellText, DocumentTree } from "./document-view";

/**
 * The Mongo Browser: collections with their counts and sizes on the left; on the right, a
 * `find` over the selected collection (filter, projection, sort, limit, skip-based pages)
 * shown as a table or as document trees, with edit, insert and delete; and its indexes.
 *
 * The collection and tab live in the URL (`?c=orders&tab=indexes`), so a view can be
 * shared, reloaded, or linked to from the Shell.
 */

export interface MongoBrowserProps {
	databaseId: string;
	databaseName: string;
	storageLimit: number;
	suspended: boolean;
}

type Tab = "documents" | "indexes";
type View = "table" | "json";

const LIMITS = [20, 50, 100, 200];

function failureText(result: { error: string; friendly?: string }): string {
	return result.friendly ? `${result.friendly}\n${result.error}` : result.error;
}

async function copyText(text: string, what: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast.success(`Copied ${what}`);
	} catch {
		toast.error("Clipboard is not available");
	}
}

/** `db.orders.find({ … })`, or the getCollection form for names that need it. */
export function collectionRef(name: string): string {
	return /^[A-Za-z_$][\w$]*$/.test(name)
		? `db.${name}`
		: `db.getCollection(${JSON.stringify(name)})`;
}

export function MongoBrowser({
	databaseId,
	databaseName,
	storageLimit,
	suspended,
}: MongoBrowserProps) {
	const desktop = useMediaQuery("(min-width: 1024px)");
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const selected = searchParams.get("c");
	const tab: Tab = searchParams.get("tab") === "indexes" ? "indexes" : "documents";

	const [overview, setOverview] = useState<DatabaseOverview | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState("");
	const [listSheet, setListSheet] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [confirm, setConfirm] = useState<ConfirmState | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const result = await mongoOverviewAction(databaseId);
			if (result.ok) {
				setOverview(result.overview);
				setError(null);
			} else setError(failureText(result));
		} catch {
			setError("Could not reach the server");
		} finally {
			setLoading(false);
		}
	}, [databaseId]);
	useEffect(() => {
		void load();
	}, [load]);

	const setParams = useCallback(
		(next: { c?: string | null; tab?: Tab }) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next.c !== undefined) {
				if (next.c) params.set("c", next.c);
				else params.delete("c");
				if (next.c !== selected) params.delete("tab");
			}
			if (next.tab) {
				if (next.tab === "documents") params.delete("tab");
				else params.set("tab", next.tab);
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
		},
		[router, pathname, searchParams, selected],
	);

	const select = (name: string | null) => {
		setParams({ c: name });
		setListSheet(false);
	};

	const collections = overview?.collections ?? [];
	const shown = filter.trim()
		? collections.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()))
		: collections;
	const current = collections.find((c) => c.name === selected) ?? null;

	const dropCollection = (name: string) =>
		setConfirm({
			title: `Drop ${name}?`,
			description: "Every document and index in this collection is deleted. There is no undo.",
			confirmLabel: "Drop collection",
			typeToConfirm: name,
			run: async () => {
				try {
					const result = await mongoDropCollectionAction(databaseId, name, name);
					if (!result.ok) return failureText(result);
					toast.success(`Dropped ${name}`);
					if (selected === name) select(null);
					void load();
					return null;
				} catch {
					return "Could not reach the server";
				}
			},
		});

	const listPane = (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-col gap-2 border-border border-b p-2">
				<div className="flex items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						className="flex-1"
						onClick={() => setCreateOpen(true)}
						disabled={suspended}
					>
						<Plus data-icon="inline-start" />
						New collection
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => void load()}
						aria-label="Reload collections"
						title="Reload collections"
						disabled={loading}
					>
						{loading ? (
							<Loader2 className="animate-spin motion-reduce:animate-none" />
						) : (
							<RefreshCw />
						)}
					</Button>
				</div>
				<label className="relative block">
					<span className="sr-only">Filter collections by name</span>
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						type="search"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder="Filter collections…"
						spellCheck={false}
						autoComplete="off"
						className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 font-mono text-[0.75rem] outline-none transition-colors placeholder:font-sans placeholder:text-[0.8125rem] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
					/>
				</label>
			</div>
			{error && !overview ? (
				<div className="p-4">
					<p
						role="alert"
						className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-destructive text-xs"
					>
						{error}
					</p>
				</div>
			) : !overview ? (
				<ListSkeleton />
			) : shown.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
					<Layers className="size-5 text-muted-foreground" strokeWidth={1.5} />
					<p className="mt-2 font-medium text-[0.8125rem]">
						{collections.length === 0 ? "No collections yet" : "No collections match"}
					</p>
					<p className="mt-1 max-w-56 text-muted-foreground text-xs leading-relaxed">
						{collections.length === 0
							? "Insert a document from your app, the Shell, or create one here."
							: `Nothing is named like "${filter.trim()}".`}
					</p>
				</div>
			) : (
				<nav
					aria-label={`Collections in ${databaseName}`}
					className="min-h-0 flex-1 overflow-y-auto py-1"
				>
					<ul>
						{shown.map((c) => (
							<li key={c.name}>
								<button
									type="button"
									onClick={() => select(c.name)}
									aria-current={c.name === selected ? "page" : undefined}
									className={cn(
										"group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
										c.name === selected ? "bg-accent" : "hover:bg-accent/50",
									)}
								>
									<Layers
										className={cn(
											"size-3.5 shrink-0",
											c.name === selected ? "text-brand-text" : "text-muted-foreground",
										)}
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate font-mono text-[0.8125rem]" translate="no">
											{c.name}
										</span>
										<span className="mt-0.5 flex gap-2 text-[0.6875rem] text-muted-foreground tabular-nums">
											{c.type !== "collection" ? (
												<span className="rounded-sm bg-muted px-1 font-medium">{c.type}</span>
											) : null}
											{c.count !== null && (
												<span>
													{c.count.toLocaleString()} {c.count === 1 ? "doc" : "docs"}
												</span>
											)}
											{c.storageSize !== null && <span>{formatBytes(c.storageSize)}</span>}
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				</nav>
			)}
			<footer className="flex h-9 shrink-0 items-center gap-2 border-border border-t px-3 text-[0.6875rem] text-muted-foreground">
				<span className="truncate tabular-nums">
					{overview
						? `${collections.length.toLocaleString()} ${collections.length === 1 ? "collection" : "collections"}`
						: "Loading…"}
				</span>
			</footer>
		</div>
	);

	return (
		<div className="flex flex-col lg:h-[calc(100dvh-3.5rem)]">
			<StatsBar
				overview={overview}
				limit={storageLimit}
				loading={loading}
				error={overview ? error : null}
				onRefresh={() => void load()}
			/>
			{suspended && (
				<p className="border-warning/30 border-b bg-warning/[0.06] px-4 py-2 text-warning text-xs">
					This database is suspended: reads and writes are refused until it is back under its
					storage limit.
				</p>
			)}
			{desktop ? (
				<div className="flex min-h-0 flex-1">
					<aside
						aria-label={`Collections in ${databaseName}`}
						className="w-[300px] shrink-0 border-border border-r bg-sidebar xl:w-[320px]"
					>
						{listPane}
					</aside>
					<div className="flex min-w-0 flex-1 flex-col bg-card">
						{current ? (
							<CollectionPanel
								key={current.name}
								databaseId={databaseId}
								collection={current}
								tab={tab}
								onTab={(t) => setParams({ tab: t })}
								onChanged={() => void load()}
								onDrop={() => dropCollection(current.name)}
								onClose={() => select(null)}
								suspended={suspended}
							/>
						) : (
							<NothingSelected
								databaseId={databaseId}
								missing={selected && overview ? selected : null}
								count={overview ? collections.length : null}
							/>
						)}
					</div>
				</div>
			) : (
				<div className="flex min-h-[calc(100dvh-7rem)] flex-1 flex-col bg-card">
					<div className="sticky top-14 z-20 flex h-11 shrink-0 items-center gap-2 border-border border-b bg-background px-3">
						<Button variant="outline" size="sm" onClick={() => setListSheet(true)}>
							<FolderTree data-icon="inline-start" />
							Collections
							{overview && (
								<span className="text-muted-foreground tabular-nums">{collections.length}</span>
							)}
						</Button>
						{current && (
							<span className="min-w-0 truncate font-mono text-[0.8125rem]" translate="no">
								{current.name}
							</span>
						)}
					</div>
					{current ? (
						<CollectionPanel
							key={current.name}
							databaseId={databaseId}
							collection={current}
							tab={tab}
							onTab={(t) => setParams({ tab: t })}
							onChanged={() => void load()}
							onDrop={() => dropCollection(current.name)}
							onClose={() => select(null)}
							suspended={suspended}
						/>
					) : (
						<NothingSelected
							databaseId={databaseId}
							missing={selected && overview ? selected : null}
							count={overview ? collections.length : null}
							onBrowse={() => setListSheet(true)}
						/>
					)}
					<Sheet open={listSheet} onOpenChange={setListSheet}>
						<SheetContent
							side="left"
							className="w-[92vw] max-w-sm gap-0 p-0"
							showCloseButton={false}
						>
							<SheetHeader className="sr-only">
								<SheetTitle>Collections</SheetTitle>
								<SheetDescription>Browse the collections in {databaseName}</SheetDescription>
							</SheetHeader>
							{listPane}
						</SheetContent>
					</Sheet>
				</div>
			)}

			<CreateCollectionDialog
				open={createOpen}
				onClose={() => setCreateOpen(false)}
				onCreate={async (name, options) => {
					try {
						const result = await mongoCreateCollectionAction(databaseId, name, options);
						if (!result.ok) return failureText(result);
						toast.success(`Created ${result.name}`);
						await load();
						select(result.name);
						return null;
					} catch {
						return "Could not reach the server";
					}
				}}
			/>
			<ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
		</div>
	);
}

/* ------------------------------------------------------------------ *
 * Stats strip
 * ------------------------------------------------------------------ */

function StatsBar({
	overview,
	limit,
	loading,
	error,
	onRefresh,
}: {
	overview: DatabaseOverview | null;
	limit: number;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
}) {
	const percent = overview
		? Math.min(100, Math.round((overview.storageSize / limit) * 1000) / 10)
		: 0;
	const warn = percent >= 80;
	return (
		<section
			aria-label="Database size"
			className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-border border-b bg-card px-3 py-2 text-xs sm:px-4"
		>
			<div className="flex min-w-0 items-center gap-2.5">
				<span className="text-muted-foreground">Storage</span>
				{overview ? (
					<>
						<span className="font-mono tabular-nums">
							{formatBytes(overview.storageSize)}
							<span className="text-muted-foreground"> / {formatBytes(limit)}</span>
						</span>
						<span
							role="meter"
							aria-label="Storage used"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={percent}
							aria-valuetext={`${percent}% of the storage limit used`}
							className="relative h-1.5 w-24 overflow-hidden rounded-full bg-foreground/[0.08] sm:w-32"
						>
							<span
								className={cn(
									"absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
									percent >= 98 ? "bg-destructive" : warn ? "bg-warning" : "bg-foreground/60",
								)}
								style={{ width: `${Math.max(percent, 1.5)}%` }}
							/>
						</span>
						<span
							className={cn(
								"tabular-nums",
								warn ? "font-medium text-warning" : "text-muted-foreground",
							)}
						>
							{percent}%
						</span>
					</>
				) : (
					<Placeholder width="w-40" />
				)}
			</div>
			<Stat label="Documents" value={overview?.objects.toLocaleString()} />
			<Stat
				label="Indexes"
				value={overview ? `${overview.indexes} · ${formatBytes(overview.indexSize)}` : undefined}
			/>
			<div className="ml-auto flex items-center gap-2">
				{error && (
					<span role="alert" className="max-w-64 truncate text-destructive" title={error}>
						{error}
					</span>
				)}
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={onRefresh}
					disabled={loading}
					aria-label="Refresh"
					title="Refresh"
				>
					{loading ? (
						<Loader2 className="animate-spin motion-reduce:animate-none" />
					) : (
						<RefreshCw />
					)}
				</Button>
			</div>
		</section>
	);
}

function Stat({ label, value }: { label: string; value: string | undefined }) {
	return (
		<div className="flex items-center gap-2">
			<span className="text-muted-foreground">{label}</span>
			{value !== undefined ? (
				<span className="font-mono tabular-nums">{value}</span>
			) : (
				<Placeholder width="w-10" />
			)}
		</div>
	);
}

function Placeholder({ width }: { width: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"h-3 animate-pulse rounded bg-foreground/[0.07] motion-reduce:animate-none",
				width,
			)}
		/>
	);
}

/* ------------------------------------------------------------------ *
 * One collection
 * ------------------------------------------------------------------ */

interface Query {
	filter: string;
	projection: string;
	sort: string;
	limit: number;
}

const EMPTY_QUERY: Query = { filter: "", projection: "", sort: "", limit: 50 };

function checkQuery(query: Query): string | null {
	for (const [label, text] of [
		["Filter", query.filter],
		["Projection", query.projection],
		["Sort", query.sort],
	] as const) {
		if (!text.trim()) continue;
		try {
			const value = parseLiteral(text);
			if (!isObject(value)) return `${label} must be a document ({ … })`;
		} catch (e) {
			return `${label}: ${describeParseError(text, e)}`;
		}
	}
	return null;
}

function CollectionPanel({
	databaseId,
	collection,
	tab,
	onTab,
	onChanged,
	onDrop,
	onClose,
	suspended,
}: {
	databaseId: string;
	collection: CollectionSummary;
	tab: Tab;
	onTab: (tab: Tab) => void;
	onChanged: () => void;
	onDrop: () => void;
	onClose: () => void;
	suspended: boolean;
}) {
	const name = collection.name;
	const isView = collection.type === "view";
	return (
		<section aria-label={`Collection ${name}`} className="flex min-h-0 flex-1 flex-col">
			<header className="shrink-0 border-border border-b px-4 pt-3 pb-0">
				<div className="flex items-start gap-2">
					<Layers className="mt-[3px] size-4 shrink-0 text-brand-text" />
					<h2
						className="min-w-0 flex-1 break-all font-medium font-mono text-[0.875rem] leading-snug"
						translate="no"
					>
						{name}
					</h2>
					<div className="-mt-1 -mr-1 flex shrink-0 items-center gap-0.5">
						<Button variant="outline" size="xs" asChild>
							<Link
								href={`/databases/${databaseId}/console?cmd=${encodeURIComponent(`${collectionRef(name)}.find({})`)}`}
							>
								<SquareTerminal data-icon="inline-start" />
								Open in shell
							</Link>
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Collection actions"
									disabled={suspended}
								>
									<MoreHorizontal />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="min-w-52">
								<DropdownMenuItem onSelect={() => void copyText(name, "collection name")}>
									<ClipboardCopy className="text-muted-foreground" />
									Copy name
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive" onSelect={onDrop}>
									<Trash2 />
									Drop collection…
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onClose}
							aria-label="Close collection"
							title="Close"
						>
							<X />
						</Button>
					</div>
				</div>
				<dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
					{collection.count !== null && (
						<Meta label="Documents">{collection.count.toLocaleString()}</Meta>
					)}
					{collection.storageSize !== null && (
						<Meta label="Storage">{formatBytes(collection.storageSize)}</Meta>
					)}
					{collection.dataSize !== null && (
						<Meta label="Data">{formatBytes(collection.dataSize)}</Meta>
					)}
					{collection.indexCount !== null && (
						<Meta label="Indexes">
							{collection.indexCount}
							{collection.totalIndexSize !== null
								? ` · ${formatBytes(collection.totalIndexSize)}`
								: ""}
						</Meta>
					)}
					{collection.type !== "collection" && <Meta label="Type">{collection.type}</Meta>}
				</dl>
				<div className="mt-2 flex">
					<SegmentedTabs
						items={[
							{ id: "documents" as const, label: "Documents", icon: Braces },
							...(isView ? [] : [{ id: "indexes" as const, label: "Indexes", icon: KeyRound }]),
						]}
						value={tab}
						onChange={onTab}
						label="Collection view"
						className="mb-2 w-auto [&>button]:px-3"
					/>
				</div>
			</header>
			{tab === "indexes" && !isView ? (
				<IndexesTab
					databaseId={databaseId}
					collection={name}
					onChanged={onChanged}
					suspended={suspended}
				/>
			) : (
				<DocumentsTab
					databaseId={databaseId}
					collection={name}
					readOnly={isView || suspended}
					onChanged={onChanged}
				/>
			)}
		</section>
	);
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-center gap-1.5">
			<dt>{label}</dt>
			<dd className="font-mono text-foreground/90 tabular-nums">{children}</dd>
		</div>
	);
}

/* ------------------------------------------------------------------ *
 * Documents
 * ------------------------------------------------------------------ */

function DocumentsTab({
	databaseId,
	collection,
	readOnly,
	onChanged,
}: {
	databaseId: string;
	collection: string;
	readOnly: boolean;
	onChanged: () => void;
}) {
	const [draft, setDraft] = useState<Query>(EMPTY_QUERY);
	const [applied, setApplied] = useState<Query>(EMPTY_QUERY);
	const [skip, setSkip] = useState(0);
	const [page, setPage] = useState<FindPage | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [count, setCount] = useState<number | null>(null);
	const [options, setOptions] = useState(false);
	const [view, setView] = useState<View>("table");
	const [inspected, setInspected] = useState<number | null>(null);
	const [docDialog, setDocDialog] = useState<Parameters<typeof DocumentDialog>[0]["state"]>(null);
	const [confirm, setConfirm] = useState<ConfirmState | null>(null);
	const generation = useRef(0);

	useEffect(() => {
		try {
			const stored = localStorage.getItem("blaze.mongo.view");
			if (stored === "table" || stored === "json") setView(stored);
		} catch {}
	}, []);
	const changeView = (next: View) => {
		setView(next);
		try {
			localStorage.setItem("blaze.mongo.view", next);
		} catch {}
	};

	const run = useCallback(
		async (query: Query, at: number) => {
			const gen = ++generation.current;
			setLoading(true);
			setError(null);
			try {
				const result = await mongoFindAction(databaseId, {
					collection,
					filter: query.filter,
					projection: query.projection,
					sort: query.sort,
					skip: at,
					limit: query.limit,
				});
				if (gen !== generation.current) return;
				if (!result.ok) {
					setError(failureText(result));
					return;
				}
				setPage(result.page);
				setSkip(at);
				setInspected(null);
			} catch {
				if (gen === generation.current) setError("Could not reach the server");
			} finally {
				if (gen === generation.current) setLoading(false);
			}
		},
		[databaseId, collection],
	);

	const loadCount = useCallback(
		async (query: Query) => {
			setCount(null);
			try {
				const result = await mongoCountAction(databaseId, collection, query.filter);
				if (result.ok) setCount(result.count);
			} catch {}
		},
		[databaseId, collection],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the first page loads once per collection.
	useEffect(() => {
		void run(EMPTY_QUERY, 0);
		void loadCount(EMPTY_QUERY);
	}, [collection]);

	const submit = () => {
		const problem = checkQuery(draft);
		if (problem) {
			setError(problem);
			return;
		}
		setApplied(draft);
		void run(draft, 0);
		void loadCount(draft);
	};

	const reset = () => {
		setDraft(EMPTY_QUERY);
		setApplied(EMPTY_QUERY);
		void run(EMPTY_QUERY, 0);
		void loadCount(EMPTY_QUERY);
	};

	const refresh = () => {
		void run(applied, skip);
		void loadCount(applied);
		onChanged();
	};

	const docs = page?.docs ?? [];
	const columns = useMemo(() => topLevelColumns(docs), [docs]);
	const grid = useMemo(() => {
		const types = columns.map((column) => {
			const seen = new Set(
				docs
					.slice(0, 50)
					.map((d) => (isObject(d) ? d[column] : undefined))
					.filter((v) => v !== undefined)
					.map((v) => bsonTypeOf(v)),
			);
			return seen.size === 1 ? [...seen][0] : seen.size === 0 ? "missing" : "mixed";
		});
		return {
			columns: columns.map((name, i) => ({ name, type: types[i] })),
			rows: docs.map((doc) =>
				columns.map((column) => {
					const value = isObject(doc) ? doc[column] : undefined;
					if (value === undefined) return null;
					if (typeof value === "number" || typeof value === "boolean") return value;
					return cellText(value);
				}),
			),
		};
	}, [docs, columns]);

	const idOf = (doc: EJsonValue): EJsonValue | undefined => (isObject(doc) ? doc._id : undefined);

	const editDoc = (doc: EJsonValue) => {
		const id = idOf(doc);
		if (id === undefined) {
			toast.error("This document has no _id, so it cannot be edited here.");
			return;
		}
		setDocDialog({
			title: "Edit document",
			description: (
				<>
					Replaces the whole document (<code className="font-mono">replaceOne</code> by{" "}
					<code className="font-mono">_id</code>). The <code className="font-mono">_id</code> cannot
					change.
				</>
			),
			initial: toShell(doc),
			submitLabel: "Save",
			submit: async (text) => {
				try {
					const result = await mongoReplaceAction(databaseId, collection, id, text);
					if (!result.ok) {
						return result.position !== undefined
							? describeParseError(text, new LiteralParseError(result.error, result.position))
							: failureText(result);
					}
					toast.success("Document saved");
					setPage((p) =>
						p
							? {
									...p,
									docs: p.docs.map((d) =>
										JSON.stringify(idOf(d)) === JSON.stringify(id) ? result.document : d,
									),
								}
							: p,
					);
					return null;
				} catch {
					return "Could not reach the server";
				}
			},
		});
	};

	const insertDoc = () =>
		setDocDialog({
			title: `Insert into ${collection}`,
			description: (
				<>
					Leave out <code className="font-mono">_id</code> and the server assigns an ObjectId.
				</>
			),
			initial: "{\n  \n}",
			submitLabel: "Insert",
			submit: async (text) => {
				try {
					const result = await mongoInsertAction(databaseId, collection, text);
					if (!result.ok) {
						return result.position !== undefined
							? describeParseError(text, new LiteralParseError(result.error, result.position))
							: failureText(result);
					}
					toast.success(`Inserted ${toShell(result.insertedId, 0)}`);
					refresh();
					return null;
				} catch {
					return "Could not reach the server";
				}
			},
		});

	const deleteDoc = (doc: EJsonValue) => {
		const id = idOf(doc);
		if (id === undefined) return;
		setConfirm({
			title: "Delete this document?",
			description: "It is removed for good (deleteOne by _id). There is no undo.",
			detail: (
				<p className="break-all rounded-lg border border-border bg-muted/40 px-3 py-2.5 font-mono text-[0.8125rem]">
					_id: {toShell(id, 0)}
				</p>
			),
			confirmLabel: "Delete document",
			run: async () => {
				try {
					const result = await mongoDeleteAction(databaseId, collection, id);
					if (!result.ok) return failureText(result);
					toast.success(result.deleted ? "Document deleted" : "It was already gone");
					setInspected(null);
					refresh();
					return null;
				} catch {
					return "Could not reach the server";
				}
			},
		});
	};

	const first = docs.length ? skip + 1 : 0;
	const last = skip + docs.length;
	const inspectedDoc = inspected !== null ? docs[inspected] : null;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<form
				className="shrink-0 space-y-2 border-border border-b px-3 py-2.5"
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<div className="flex items-stretch gap-1.5">
					<QueryField
						label="Filter"
						value={draft.filter}
						onChange={(v) => setDraft((d) => ({ ...d, filter: v }))}
						onSubmit={submit}
						placeholder="{ status: 'paid', total: { $gt: 100 } }"
					/>
					<Button
						type="button"
						variant={options ? "secondary" : "ghost"}
						size="icon"
						onClick={() => setOptions((o) => !o)}
						aria-expanded={options}
						aria-label="Projection, sort and limit"
						title="Projection, sort and limit"
					>
						<SlidersHorizontal />
					</Button>
					<Button type="submit" size="default" disabled={loading}>
						{loading ? (
							<Loader2
								className="animate-spin motion-reduce:animate-none"
								data-icon="inline-start"
							/>
						) : (
							<Play data-icon="inline-start" />
						)}
						Find
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={reset}
						aria-label="Reset query"
						title="Reset query"
					>
						<RotateCcw />
					</Button>
				</div>
				{options && (
					<div className="grid gap-1.5 md:grid-cols-[1fr_1fr_auto]">
						<QueryField
							label="Project"
							value={draft.projection}
							onChange={(v) => setDraft((d) => ({ ...d, projection: v }))}
							onSubmit={submit}
							placeholder="{ email: 1, name: 1 }"
						/>
						<QueryField
							label="Sort"
							value={draft.sort}
							onChange={(v) => setDraft((d) => ({ ...d, sort: v }))}
							onSubmit={submit}
							placeholder="{ createdAt: -1 }"
						/>
						<div className="flex items-center gap-2">
							<span className="text-muted-foreground text-xs">Limit</span>
							<Select
								value={String(draft.limit)}
								onValueChange={(v) => setDraft((d) => ({ ...d, limit: Number(v) }))}
							>
								<SelectTrigger size="sm" className="w-20 text-xs" aria-label="Documents per page">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{LIMITS.map((n) => (
										<SelectItem key={n} value={String(n)}>
											{n}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				)}
			</form>

			<div className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-2">
				<SegmentedTabs
					items={[
						{ id: "table" as const, label: "Table", icon: Table2 },
						{ id: "json" as const, label: "JSON", icon: Braces },
					]}
					value={view}
					onChange={changeView}
					label="Show documents as"
					className="w-auto [&>button]:px-2.5"
				/>
				<span className="hidden truncate text-[0.6875rem] text-muted-foreground tabular-nums sm:inline">
					{page ? `${page.durationMs} ms` : ""}
				</span>
				<div className="ml-auto flex items-center gap-1">
					<span
						className="px-1 text-[0.6875rem] text-muted-foreground tabular-nums"
						aria-live="polite"
					>
						{page
							? docs.length
								? `${first.toLocaleString()}–${last.toLocaleString()}${count !== null ? ` of ${count.toLocaleString()}` : ""}`
								: count === 0 || skip === 0
									? "No documents"
									: "Past the end"
							: ""}
					</span>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Previous page"
						title="Previous page"
						disabled={loading || skip === 0}
						onClick={() => void run(applied, Math.max(0, skip - applied.limit))}
					>
						<ChevronLeft />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Next page"
						title="Next page"
						disabled={loading || !page?.hasMore}
						onClick={() => void run(applied, skip + docs.length)}
					>
						<ChevronRight />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Reload documents"
						title="Reload"
						disabled={loading}
						onClick={refresh}
					>
						<RefreshCw />
					</Button>
					{!readOnly && (
						<Button variant="outline" size="xs" onClick={insertDoc} className="ml-1">
							<Plus data-icon="inline-start" />
							Insert
						</Button>
					)}
				</div>
			</div>

			{error && (
				<div className="shrink-0 px-3 pt-3">
					<p
						role="alert"
						className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 font-mono text-destructive text-xs"
					>
						{error}
					</p>
				</div>
			)}
			{page?.clipped && (
				<p className="shrink-0 border-border border-b bg-warning/[0.06] px-3 py-1.5 text-warning text-xs">
					These documents are large: the page was cut short to stay under 4 MB. Use a projection or
					a smaller limit.
				</p>
			)}

			{!page ? (
				loading ? (
					<GridSkeleton />
				) : null
			) : docs.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
					<Database className="size-5 text-muted-foreground" strokeWidth={1.5} />
					<p className="mt-2 font-medium text-[0.8125rem]">
						{applied.filter.trim() ? "No documents match" : "This collection is empty"}
					</p>
					<p className="mt-1 max-w-64 text-muted-foreground text-xs leading-relaxed">
						{applied.filter.trim()
							? "Nothing matches the filter. Loosen it, or reset the query."
							: "Insert one here, or write from your app or the Shell."}
					</p>
				</div>
			) : view === "table" ? (
				<div className={cn("flex min-h-0 flex-1 flex-col", loading && "opacity-70")}>
					<DataGrid
						columns={grid.columns}
						rows={grid.rows}
						onInspect={(i) => setInspected(i)}
						inspectedRow={inspected}
						label={`Documents in ${collection}`}
						inspectLabel="Open document"
					/>
				</div>
			) : (
				<div
					className={cn(
						"min-h-0 flex-1 space-y-2 overflow-y-auto bg-[var(--code-background)] p-3",
						loading && "opacity-70",
					)}
				>
					{docs.map((doc, i) => (
						<article
							key={JSON.stringify(idOf(doc) ?? i)}
							className="rounded-lg border border-border bg-card py-1"
							aria-label={`Document ${toShell(idOf(doc) ?? i, 0)}`}
						>
							<DocumentTree
								doc={doc}
								openDepth={1}
								actions={
									<DocActions
										doc={doc}
										readOnly={readOnly}
										onEdit={() => editDoc(doc)}
										onDelete={() => deleteDoc(doc)}
									/>
								}
							/>
						</article>
					))}
				</div>
			)}

			<Sheet open={inspectedDoc !== null} onOpenChange={(open) => !open && setInspected(null)}>
				<SheetContent side="right" className="w-[94vw] gap-0 p-0 sm:max-w-xl">
					<SheetHeader className="border-border border-b px-4 py-3">
						<SheetTitle className="font-mono text-sm">
							{inspectedDoc ? toShell(idOf(inspectedDoc) ?? "document", 0) : "Document"}
						</SheetTitle>
						<SheetDescription>
							{collection} · document{" "}
							{inspected !== null ? (skip + inspected + 1).toLocaleString() : ""}
						</SheetDescription>
						{inspectedDoc && (
							<div className="flex gap-1.5 pt-1">
								{!readOnly && (
									<>
										<Button size="xs" variant="outline" onClick={() => editDoc(inspectedDoc)}>
											<Pencil data-icon="inline-start" />
											Edit
										</Button>
										<Button
											size="xs"
											variant="destructive-outline"
											onClick={() => deleteDoc(inspectedDoc)}
										>
											<Trash2 data-icon="inline-start" />
											Delete
										</Button>
									</>
								)}
								<Button
									size="xs"
									variant="ghost"
									onClick={() => void copyText(toShell(inspectedDoc), "document")}
								>
									<ClipboardCopy data-icon="inline-start" />
									Copy
								</Button>
							</div>
						)}
					</SheetHeader>
					<div className="min-h-0 flex-1 overflow-y-auto bg-[var(--code-background)] py-2">
						{inspectedDoc && <DocumentTree doc={inspectedDoc} openDepth={3} />}
					</div>
				</SheetContent>
			</Sheet>

			<DocumentDialog state={docDialog} onClose={() => setDocDialog(null)} />
			<ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
		</div>
	);
}

function DocActions({
	doc,
	readOnly,
	onEdit,
	onDelete,
}: {
	doc: EJsonValue;
	readOnly: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const btn =
		"flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";
	return (
		<>
			<button
				type="button"
				className={btn}
				onClick={() => void copyText(toShell(doc), "document")}
				aria-label="Copy document"
				title="Copy"
			>
				<ClipboardCopy className="size-3.5" />
			</button>
			{!readOnly && (
				<>
					<button
						type="button"
						className={btn}
						onClick={onEdit}
						aria-label="Edit document"
						title="Edit"
					>
						<Pencil className="size-3.5" />
					</button>
					<button
						type="button"
						className={cn(btn, "hover:text-destructive")}
						onClick={onDelete}
						aria-label="Delete document"
						title="Delete"
					>
						<Trash2 className="size-3.5" />
					</button>
				</>
			)}
		</>
	);
}

function QueryField({
	label,
	value,
	onChange,
	onSubmit,
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	placeholder: string;
}) {
	return (
		<div className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-md border border-input bg-[var(--code-background)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
			<span className="flex shrink-0 items-center border-border border-r bg-card px-2 font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wide">
				{label}
			</span>
			<CodeEditor
				value={value}
				onChange={onChange}
				onSubmit={onSubmit}
				ariaLabel={label}
				placeholder={placeholder}
				singleLine
				className="flex-1 [&_.cm-editor]:bg-transparent"
			/>
		</div>
	);
}

/* ------------------------------------------------------------------ *
 * Indexes
 * ------------------------------------------------------------------ */

function IndexesTab({
	databaseId,
	collection,
	onChanged,
	suspended,
}: {
	databaseId: string;
	collection: string;
	onChanged: () => void;
	suspended: boolean;
}) {
	const [indexes, setIndexes] = useState<IndexInfo[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [confirm, setConfirm] = useState<ConfirmState | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const result = await mongoIndexesAction(databaseId, collection);
			if (result.ok) {
				setIndexes(result.indexes);
				setError(null);
			} else setError(failureText(result));
		} catch {
			setError("Could not reach the server");
		} finally {
			setLoading(false);
		}
	}, [databaseId, collection]);
	useEffect(() => {
		void load();
	}, [load]);

	const drop = (index: IndexInfo) =>
		setConfirm({
			title: `Drop index ${index.name}?`,
			description:
				"Queries that relied on it fall back to scanning. It can be created again later.",
			detail: (
				<p className="break-all rounded-lg border border-border bg-muted/40 px-3 py-2.5 font-mono text-[0.8125rem]">
					{toShell(index.key, 0)}
				</p>
			),
			confirmLabel: "Drop index",
			run: async () => {
				try {
					const result = await mongoDropIndexAction(databaseId, collection, index.name);
					if (!result.ok) return failureText(result);
					toast.success(`Dropped ${index.name}`);
					void load();
					onChanged();
					return null;
				} catch {
					return "Could not reach the server";
				}
			},
		});

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-3">
				<span className="text-muted-foreground text-xs tabular-nums">
					{indexes ? `${indexes.length} ${indexes.length === 1 ? "index" : "indexes"}` : ""}
				</span>
				<div className="ml-auto flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={() => void load()}
						disabled={loading}
						aria-label="Reload indexes"
						title="Reload"
					>
						<RefreshCw />
					</Button>
					<Button
						variant="outline"
						size="xs"
						onClick={() => setCreateOpen(true)}
						disabled={suspended}
					>
						<Plus data-icon="inline-start" />
						Create index
					</Button>
				</div>
			</div>
			{error && (
				<div className="px-3 pt-3">
					<p
						role="alert"
						className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-destructive text-xs"
					>
						{error}
					</p>
				</div>
			)}
			{!indexes ? (
				!error && <GridSkeleton />
			) : (
				<div className="min-h-0 flex-1 overflow-auto">
					<table className="w-full min-w-[640px] border-collapse text-[0.8125rem]">
						<thead className="sticky top-0 z-10 bg-card">
							<tr className="border-border border-b text-left text-muted-foreground text-xs">
								<th className="px-3 py-2 font-medium">Name</th>
								<th className="px-3 py-2 font-medium">Keys</th>
								<th className="px-3 py-2 font-medium">Properties</th>
								<th className="px-3 py-2 text-right font-medium">Size</th>
								<th className="w-12 px-3 py-2">
									<span className="sr-only">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{indexes.map((index) => (
								<tr
									key={index.name}
									className="border-border border-b last:border-0 hover:bg-accent/30"
								>
									<td className="px-3 py-2 align-top font-mono" translate="no">
										{index.name}
									</td>
									<td className="px-3 py-2 align-top font-mono text-foreground/90" translate="no">
										{toShell(index.key, 0)}
									</td>
									<td className="px-3 py-2 align-top">
										<div className="flex flex-wrap gap-1">
											{index.name === "_id_" && <Badge>primary</Badge>}
											{index.unique && <Badge>unique</Badge>}
											{index.sparse && <Badge>sparse</Badge>}
											{index.expireAfterSeconds !== null && (
												<Badge
													title={`Documents expire ${index.expireAfterSeconds}s after the indexed date`}
												>
													TTL {formatSeconds(index.expireAfterSeconds)}
												</Badge>
											)}
											{index.partialFilterExpression && (
												<Badge title={toShell(index.partialFilterExpression, 0)}>partial</Badge>
											)}
											{Object.keys(index.extra).map((k) => (
												<Badge key={k} title={toShell(index.extra[k], 0)}>
													{k}
												</Badge>
											))}
										</div>
									</td>
									<td className="px-3 py-2 text-right align-top font-mono text-muted-foreground tabular-nums">
										{index.size !== null ? formatBytes(index.size) : "–"}
									</td>
									<td className="px-2 py-1.5 text-right align-top">
										{index.name !== "_id_" && (
											<Button
												variant="ghost"
												size="icon-xs"
												onClick={() => drop(index)}
												disabled={suspended}
												aria-label={`Drop index ${index.name}`}
												title="Drop index"
												className="hover:text-destructive"
											>
												<Trash2 />
											</Button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<CreateIndexDialog
				collection={collection}
				open={createOpen}
				onClose={() => setCreateOpen(false)}
				onCreate={async (draft) => {
					try {
						const result = await mongoCreateIndexAction(databaseId, {
							collection,
							keys: draft.keys,
							name: draft.name,
							unique: draft.unique,
							sparse: draft.sparse,
							expireAfterSeconds: draft.ttl ? Number(draft.ttl) : null,
							options: draft.options,
						});
						if (!result.ok) return failureText(result);
						toast.success(`Created ${result.name}`);
						void load();
						onChanged();
						return null;
					} catch {
						return "Could not reach the server";
					}
				}}
			/>
			<ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
		</div>
	);
}

function formatSeconds(seconds: number): string {
	if (seconds % 86400 === 0) return `${seconds / 86400}d`;
	if (seconds % 3600 === 0) return `${seconds / 3600}h`;
	if (seconds % 60 === 0) return `${seconds / 60}m`;
	return `${seconds}s`;
}

function Badge({ children, title }: { children: ReactNode; title?: string }) {
	return (
		<span
			title={title}
			className="inline-flex h-5 items-center rounded-sm border border-border bg-muted/50 px-1.5 font-medium text-[0.6875rem] text-muted-foreground"
		>
			{children}
		</span>
	);
}

/* ------------------------------------------------------------------ *
 * Empty and loading states
 * ------------------------------------------------------------------ */

function NothingSelected({
	databaseId,
	missing,
	count,
	onBrowse,
}: {
	databaseId: string;
	missing: string | null;
	count: number | null;
	onBrowse?: () => void;
}) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
			<div className="relative mb-5">
				<div className="absolute -inset-4 rounded-full bg-[radial-gradient(closest-side,var(--brand-soft),transparent)]" />
				<span className="relative flex size-11 items-center justify-center rounded-xl border border-border bg-background shadow-xs">
					<Layers className="size-5 text-muted-foreground" strokeWidth={1.5} />
				</span>
			</div>
			<p className="font-medium text-[0.9375rem]">
				{missing ? `There is no collection named ${missing}` : "Pick a collection to browse it"}
			</p>
			<p className="mt-1.5 max-w-sm text-balance text-muted-foreground text-sm leading-relaxed">
				{count !== null
					? `${count.toLocaleString()} ${count === 1 ? "collection" : "collections"} in this database. `
					: ""}
				Filter documents, edit them in place, and manage indexes.
			</p>
			<div className="mt-5 flex flex-wrap items-center justify-center gap-2">
				{onBrowse && (
					<Button size="sm" onClick={onBrowse}>
						<FolderTree data-icon="inline-start" />
						Browse collections
					</Button>
				)}
				<Button size="sm" variant="outline" asChild>
					<Link href={`/databases/${databaseId}/console`}>
						<SquareTerminal data-icon="inline-start" />
						Open shell
					</Link>
				</Button>
			</div>
		</div>
	);
}

function ListSkeleton() {
	return (
		<div className="space-y-3 p-3" aria-hidden="true">
			{[64, 48, 72, 40, 56].map((width, i) => (
				<div key={i} className="space-y-1.5">
					<div
						className="h-3 animate-pulse rounded bg-foreground/[0.07] motion-reduce:animate-none"
						style={{ width: `${width}%` }}
					/>
					<div className="h-2.5 w-24 animate-pulse rounded bg-foreground/[0.05] motion-reduce:animate-none" />
				</div>
			))}
		</div>
	);
}

function GridSkeleton() {
	return (
		<div className="space-y-2.5 p-4" aria-hidden="true">
			{[92, 84, 88, 76, 90, 70].map((width, i) => (
				<div
					key={i}
					className="h-3 animate-pulse rounded bg-foreground/[0.06] motion-reduce:animate-none"
					style={{ width: `${width}%` }}
				/>
			))}
		</div>
	);
}

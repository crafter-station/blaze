"use client";

import {
	ChevronDown,
	Loader2,
	PanelLeft,
	PanelLeftClose,
	Play,
	Plus,
	WandSparkles,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { format as formatSql } from "sql-formatter";
import {
	introspectAction,
	runSqlAction,
	tableDdlAction,
} from "@/app/(dashboard)/databases/[id]/sql/actions";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { detectDestructive } from "@/lib/sql/destructive";
import { DIALECTS, qualifiedName } from "@/lib/sql/dialect";
import { locateError } from "@/lib/sql/error-position";
import { type Statement, splitStatements, statementAt, statementsInRange } from "@/lib/sql/split";
import type { SchemaSnapshot, SchemaTable, SqlEngine } from "@/lib/sql/types";
import { cn } from "@/lib/utils";
import { ConfirmDestructive, DdlDialog, type PendingConfirmation } from "./dialogs";
import { type EditorApi, type EditorError, type EditorHandlers, SqlCodeEditor } from "./editor";
import { isMacPlatform, useMediaQuery } from "./hooks";
import { ResultsPanel, type RunEntry, type RunRecord } from "./results-panel";
import { SchemaExplorer } from "./schema-explorer";

/**
 * The SQL console: query tabs over one CodeMirror editor, a schema explorer, and a results
 * panel with one tab per executed statement.
 *
 * Everything that touches the database goes through server actions that resolve the
 * database by ownership and connect as the tenant role. The client decides only *what* to
 * send: the statement under the cursor, the selection, or the whole script.
 */

export interface ConsoleProps {
	databaseId: string;
	databaseName: string;
	engine: SqlEngine;
	roleName: string;
	timeoutSeconds: number;
	maxRows: number;
	aiEnabled: boolean;
}

interface QueryTab {
	id: string;
	title: string;
	sql: string;
}

interface TabResults {
	run: RunRecord | null;
	active: number | string;
	/** Document text at the time of the run, to map error offsets after edits. */
	doc: string;
}

const STARTERS: Record<SqlEngine, string> = {
	postgres:
		"select table_schema, table_name\nfrom information_schema.tables\nwhere table_schema not in ('pg_catalog', 'information_schema')\norder by 1, 2;\n",
	mysql:
		"select table_name, table_rows\nfrom information_schema.tables\nwhere table_schema = database()\norder by 1;\n",
	mariadb:
		"select table_name, table_rows\nfrom information_schema.tables\nwhere table_schema = database()\norder by 1;\n",
	libsql: "select name, type\nfrom sqlite_master\nwhere name not like 'sqlite_%'\norder by 1;\n",
};

/** Schema snapshots survive client-side navigation; refresh is explicit or after DDL. */
const schemaCache = new Map<string, SchemaSnapshot>();
const schemaRequests = new Map<string, ReturnType<typeof introspectAction>>();

const storageKey = (databaseId: string) => `blaze.sql.tabs.${databaseId}`;

function newTabId() {
	return Math.random().toString(36).slice(2, 10);
}

function readTabs(databaseId: string, engine: SqlEngine): { tabs: QueryTab[]; activeId: string } {
	try {
		const raw = localStorage.getItem(storageKey(databaseId));
		if (raw) {
			const parsed = JSON.parse(raw) as { tabs: QueryTab[]; activeId: string };
			if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
				const tabs = parsed.tabs
					.filter((t) => t && typeof t.sql === "string")
					.slice(0, 20)
					.map((t) => ({ id: String(t.id), title: String(t.title || "Query"), sql: t.sql }));
				const activeId = tabs.some((t) => t.id === parsed.activeId) ? parsed.activeId : tabs[0].id;
				return { tabs, activeId };
			}
		}
	} catch {
		// Storage unavailable or corrupt: start fresh.
	}
	const id = newTabId();
	return { tabs: [{ id, title: "Query 1", sql: STARTERS[engine] }], activeId: id };
}

const DDL_VERBS = /^\s*(create|alter|drop|rename|comment)\b/i;

export function SqlConsole(props: ConsoleProps) {
	const { databaseId, databaseName, engine, roleName, timeoutSeconds, maxRows, aiEnabled } = props;
	const desktop = useMediaQuery("(min-width: 1024px)");
	const mod = isMacPlatform() ? "⌘" : "Ctrl+";

	/* ---------------- tabs ---------------- */

	const [tabs, setTabs] = useState<QueryTab[]>(() => [
		{ id: "initial", title: "Query 1", sql: STARTERS[engine] },
	]);
	const [activeId, setActiveId] = useState("initial");
	const [hydrated, setHydrated] = useState(false);
	const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

	useEffect(() => {
		const stored = readTabs(databaseId, engine);
		setTabs(stored.tabs);
		setActiveId(stored.activeId);
		setHydrated(true);
	}, [databaseId, engine]);

	useEffect(() => {
		if (!hydrated) return;
		const timer = setTimeout(() => {
			try {
				localStorage.setItem(storageKey(databaseId), JSON.stringify({ tabs, activeId }));
			} catch {
				// Quota or privacy mode: tabs simply do not persist.
			}
		}, 300);
		return () => clearTimeout(timer);
	}, [tabs, activeId, hydrated, databaseId]);

	const updateActiveSql = useCallback(
		(sql: string) => setTabs((list) => list.map((t) => (t.id === activeId ? { ...t, sql } : t))),
		[activeId],
	);

	const openTab = useCallback((sql: string, title?: string) => {
		const id = newTabId();
		setTabs((list) => {
			const n = list.length + 1;
			return [...list, { id, title: title ?? `Query ${n}`, sql }].slice(-20);
		});
		setActiveId(id);
		return id;
	}, []);

	const closeTab = useCallback(
		(id: string) => {
			const index = tabs.findIndex((t) => t.id === id);
			if (index === -1) return;
			if (tabs.length === 1) {
				const fresh = { id: newTabId(), title: "Query 1", sql: "" };
				setTabs([fresh]);
				setActiveId(fresh.id);
			} else {
				const next = tabs.filter((t) => t.id !== id);
				setTabs(next);
				if (id === activeId) setActiveId(next[Math.max(0, index - 1)].id);
			}
			setResults((map) => {
				const copy = { ...map };
				delete copy[id];
				return copy;
			});
		},
		[tabs, activeId],
	);

	/* ---------------- schema ---------------- */

	const [snapshot, setSnapshot] = useState<SchemaSnapshot | null>(
		() => schemaCache.get(databaseId) ?? null,
	);
	const [schemaLoading, setSchemaLoading] = useState(false);
	const [schemaError, setSchemaError] = useState<string | null>(null);

	const loadSchema = useCallback(async () => {
		setSchemaLoading(true);
		setSchemaError(null);
		try {
			// One request per database at a time, however many times this is called.
			let request = schemaRequests.get(databaseId);
			if (!request) {
				request = introspectAction(databaseId).finally(() => schemaRequests.delete(databaseId));
				schemaRequests.set(databaseId, request);
			}
			const result = await request;
			if (result.ok) {
				schemaCache.set(databaseId, result.snapshot);
				setSnapshot(result.snapshot);
			} else setSchemaError(result.error);
		} catch {
			setSchemaError("Could not reach the server");
		} finally {
			setSchemaLoading(false);
		}
	}, [databaseId]);

	useEffect(() => {
		if (!schemaCache.has(databaseId)) void loadSchema();
	}, [databaseId, loadSchema]);

	/* ---------------- execution ---------------- */

	const apiRef = useRef<EditorApi | null>(null);
	const [results, setResults] = useState<Record<string, TabResults>>({});
	const [pending, setPending] = useState<{ tabId: string; since: number } | null>(null);
	const [confirm, setConfirm] = useState<PendingConfirmation | null>(null);
	const [editorError, setEditorError] = useState<EditorError | null>(null);
	const current = results[active.id];

	const markError = useCallback(
		(entry: RunEntry, doc: string): boolean => {
			const span = locateError(engine, entry.text, {
				message: entry.outcome.error ?? "",
				position: entry.outcome.errorPosition,
			});
			if (!span) return false;
			const now = apiRef.current?.getDoc() ?? "";
			// The text may have moved since the run; find the statement again.
			let base = entry.from;
			if (now !== doc) {
				const at = now.indexOf(entry.text);
				if (at === -1) return false;
				base = at;
			}
			const error = {
				from: base + span.from,
				to: base + span.to,
				message: entry.outcome.error ?? "",
			};
			setEditorError(error);
			apiRef.current?.select(error.from, error.to);
			return true;
		},
		[engine],
	);

	const execute = useCallback(
		async (statements: Statement[], tabId: string, doc: string) => {
			setPending({ tabId, since: Date.now() });
			setEditorError(null);
			const startedAt = Date.now();
			let record: RunRecord;
			try {
				const outcome = await runSqlAction(
					databaseId,
					statements.map((s) => s.text),
				);
				record = {
					id: newTabId(),
					startedAt,
					finishedAt: Date.now(),
					error: outcome.results.length === 0 ? outcome.error : undefined,
					entries: outcome.results.map((result, i) => ({
						text: statements[i].text,
						from: statements[i].from,
						to: statements[i].to,
						outcome: result,
					})),
				};
			} catch {
				record = {
					id: newTabId(),
					startedAt,
					finishedAt: Date.now(),
					entries: [],
					error: "Could not reach the server. Check your connection and try again.",
				};
			}
			setPending(null);

			const failed = record.entries.findIndex((e) => !e.outcome.ok && !e.outcome.skipped);
			let activeTab = failed;
			if (activeTab === -1) {
				const withRows = record.entries.map((e) => e.outcome.columns.length > 0);
				activeTab = withRows.lastIndexOf(true);
				if (activeTab === -1) activeTab = Math.max(0, record.entries.length - 1);
			}
			setResults((map) => ({ ...map, [tabId]: { run: record, active: activeTab, doc } }));

			if (failed !== -1 && tabId === activeIdRef.current) markError(record.entries[failed], doc);
			if (record.entries.some((e) => e.outcome.ok && DDL_VERBS.test(e.text))) void loadSchema();
		},
		[databaseId, loadSchema, markError],
	);

	const activeIdRef = useRef(activeId);
	activeIdRef.current = activeId;

	const runStatements = useCallback(
		(statements: Statement[]) => {
			if (pending) return;
			const doc = apiRef.current?.getDoc() ?? "";
			if (statements.length === 0) {
				toast.message("Nothing to run", {
					description: "The editor has no statement at the cursor.",
				});
				return;
			}
			const tabId = activeIdRef.current;
			const flagged = statements
				.map((s) => ({ text: s.text, finding: detectDestructive(s.text, engine) }))
				.filter((x): x is { text: string; finding: NonNullable<typeof x.finding> } => !!x.finding);
			if (flagged.length > 0) {
				setConfirm({
					flagged,
					total: statements.length,
					run: () => void execute(statements, tabId, doc),
				});
				return;
			}
			void execute(statements, tabId, doc);
		},
		[pending, engine, execute],
	);

	const collect = useCallback(
		(mode: "cursor" | "all"): Statement[] => {
			const api = apiRef.current;
			if (!api) return [];
			const doc = api.getDoc();
			if (mode === "all") return splitStatements(doc, engine);
			const selection = api.getSelection();
			if (selection.from !== selection.to) {
				return statementsInRange(doc, selection.from, selection.to, engine);
			}
			const statement = statementAt(splitStatements(doc, engine), selection.from);
			return statement ? [statement] : [];
		},
		[engine],
	);

	const format = useCallback(() => {
		const api = apiRef.current;
		if (!api) return;
		const doc = api.getDoc();
		const selection = api.getSelection();
		const range = selection.from !== selection.to ? selection : { from: 0, to: doc.length };
		try {
			const formatted = formatSql(doc.slice(range.from, range.to), {
				language: DIALECTS[engine].formatter,
				keywordCase: "upper",
				tabWidth: 2,
				linesBetweenQueries: 1,
			});
			const next = doc.slice(0, range.from) + formatted + doc.slice(range.to);
			api.replaceAll(range.from === 0 && range.to === doc.length ? `${formatted}\n` : next);
		} catch (error) {
			toast.error("Could not format this SQL", {
				description: error instanceof Error ? error.message.split("\n")[0] : undefined,
			});
		}
	}, [engine]);

	/* ---------------- handlers bound into the editor keymap ---------------- */

	const handlers = useRef<EditorHandlers>({
		run: () => {},
		runAll: () => {},
		explain: () => {},
		format: () => {},
		save: () => {},
		palette: () => {},
	});
	handlers.current = {
		run: () => runStatements(collect("cursor")),
		runAll: () => runStatements(collect("all")),
		explain: () => toast.message("EXPLAIN is coming in the next step."),
		format,
		save: () => {},
		palette: () => {},
	};

	/* ---------------- explorer actions ---------------- */

	const [ddl, setDdl] = useState<{
		title: string;
		ddl: string | null;
		error: string | null;
	} | null>(null);
	const [explorerOpen, setExplorerOpen] = useState(true);
	const [explorerSheet, setExplorerSheet] = useState(false);

	const tableActions = useMemo(
		() => ({
			insert: (text: string) => {
				apiRef.current?.insert(text);
				setExplorerSheet(false);
			},
			selectStar: (table: SchemaTable) => {
				const name = qualifiedName(engine, table.schema, table.name, snapshot?.defaultSchema ?? "");
				const sql = `select *\nfrom ${name}\nlimit 100;\n`;
				const tabId = openTab(sql, table.name);
				setExplorerSheet(false);
				const statement = splitStatements(sql, engine);
				// Run once the new tab's editor holds the text.
				setTimeout(() => {
					activeIdRef.current = tabId;
					void execute(statement, tabId, sql);
				}, 0);
			},
			viewDdl: async (table: SchemaTable) => {
				const title = `${table.schema}.${table.name}`;
				setDdl({ title, ddl: null, error: null });
				setExplorerSheet(false);
				const result = await tableDdlAction(databaseId, table.schema, table.name);
				setDdl(
					result.ok
						? { title, ddl: result.ddl, error: null }
						: { title, ddl: null, error: result.error },
				);
			},
		}),
		[engine, snapshot, openTab, execute, databaseId],
	);

	/* ---------------- layout: resizable editor height ---------------- */

	const [editorShare, setEditorShare] = useState(0.45);
	const splitRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		try {
			const saved = Number(localStorage.getItem("blaze.sql.split"));
			if (saved > 0.15 && saved < 0.85) setEditorShare(saved);
		} catch {}
	}, []);
	const setShare = useCallback((share: number) => {
		const next = Math.min(0.8, Math.max(0.18, share));
		setEditorShare(next);
		try {
			localStorage.setItem("blaze.sql.split", String(next));
		} catch {}
	}, []);

	function startResize(event: React.PointerEvent) {
		const container = splitRef.current;
		if (!container) return;
		event.preventDefault();
		const rect = container.getBoundingClientRect();
		const move = (e: PointerEvent) => setShare((e.clientY - rect.top) / rect.height);
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}

	const isPending = pending?.tabId === active.id;
	const explorer = (
		<SchemaExplorer
			databaseId={databaseId}
			engine={engine}
			snapshot={snapshot}
			loading={schemaLoading}
			error={schemaError}
			onRefresh={() => void loadSchema()}
			actions={tableActions}
			className="h-full"
		/>
	);

	return (
		<div className="flex flex-col lg:h-[calc(100dvh-3.5rem)]">
			<div className="flex min-h-0 flex-1">
				{desktop && explorerOpen && (
					<aside
						aria-label="Schema"
						className="w-[264px] shrink-0 border-border border-r bg-sidebar"
					>
						{explorer}
					</aside>
				)}

				<div className="flex min-w-0 flex-1 flex-col">
					{/* Tab strip */}
					<div className="flex h-10 shrink-0 items-center gap-1 border-border border-b bg-background pr-2 pl-1.5">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => (desktop ? setExplorerOpen((v) => !v) : setExplorerSheet(true))}
							aria-label={desktop && explorerOpen ? "Hide schema" : "Show schema"}
							title={desktop && explorerOpen ? "Hide schema" : "Show schema"}
						>
							{desktop && explorerOpen ? <PanelLeftClose /> : <PanelLeft />}
						</Button>
						<div
							role="tablist"
							aria-label="Queries"
							className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
						>
							{tabs.map((tab) => {
								const selected = tab.id === active.id;
								return (
									<div
										key={tab.id}
										className={cn(
											"group/tab relative flex h-8 shrink-0 items-center rounded-md text-[0.8125rem] transition-colors",
											selected
												? "bg-accent text-foreground"
												: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
										)}
									>
										<button
											type="button"
											role="tab"
											aria-selected={selected}
											onClick={() => setActiveId(tab.id)}
											onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
											className="flex h-full max-w-[180px] items-center gap-1.5 rounded-md pr-1 pl-2.5 focus-visible:outline-2 focus-visible:outline-ring"
										>
											{pending?.tabId === tab.id && (
												<Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
											)}
											<span className="truncate">{tab.title}</span>
										</button>
										<button
											type="button"
											onClick={() => closeTab(tab.id)}
											aria-label={`Close ${tab.title}`}
											className={cn(
												"mr-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
												!selected &&
													"opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
											)}
										>
											<X className="size-3" />
										</button>
										{selected && (
											<span
												aria-hidden="true"
												className="absolute inset-x-2 -bottom-[5px] h-0.5 rounded-full bg-brand"
											/>
										)}
									</div>
								);
							})}
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => openTab("")}
								aria-label="New query tab"
								title="New query tab"
							>
								<Plus />
							</Button>
						</div>
					</div>

					{/* Toolbar */}
					<div className="flex h-11 shrink-0 items-center gap-1.5 border-border border-b bg-card px-2">
						<div className="flex items-center">
							<Button
								size="sm"
								onClick={() => handlers.current.run()}
								disabled={!!pending}
								className="rounded-r-none"
								title={`Run statement at cursor or selection (${mod}Enter)`}
							>
								{isPending ? (
									<Loader2
										className="animate-spin motion-reduce:animate-none"
										data-icon="inline-start"
									/>
								) : (
									<Play data-icon="inline-start" />
								)}
								{isPending ? "Running…" : "Run"}
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										size="icon-sm"
										disabled={!!pending}
										className="rounded-l-none border-l border-l-black/15"
										aria-label="More run options"
									>
										<ChevronDown />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="min-w-60">
									<DropdownMenuItem onSelect={() => handlers.current.run()}>
										Run statement or selection
										<DropdownMenuShortcut>{mod}Enter</DropdownMenuShortcut>
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={() => handlers.current.runAll()}>
										Run all statements
										<DropdownMenuShortcut>⇧{mod}Enter</DropdownMenuShortcut>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
						<Button variant="ghost" size="sm" onClick={format} title="Format SQL (Shift+Alt+F)">
							<WandSparkles data-icon="inline-start" />
							<span className="hidden sm:inline">Format</span>
						</Button>
						<p className="ml-auto hidden truncate text-[0.6875rem] text-muted-foreground xl:block">
							Runs as <span className="font-mono text-foreground/80">{roleName}</span> on{" "}
							<span className="font-mono text-foreground/80">{databaseName}</span> ·{" "}
							{timeoutSeconds}s timeout · first {maxRows} rows
						</p>
					</div>

					<div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
						<div
							className="relative h-[42dvh] min-h-[200px] shrink-0 lg:h-auto lg:min-h-[120px]"
							style={desktop ? { height: `${editorShare * 100}%` } : undefined}
						>
							<SqlCodeEditor
								key={active.id}
								value={active.sql}
								onChange={(value) => {
									updateActiveSql(value);
									if (editorError) setEditorError(null);
								}}
								engine={engine}
								snapshot={snapshot}
								handlers={handlers}
								error={editorError}
								apiRef={apiRef}
								label={`SQL editor, ${active.title}`}
							/>
						</div>

						{desktop ? (
							<div
								role="separator"
								aria-orientation="horizontal"
								aria-label="Resize editor"
								aria-valuenow={Math.round(editorShare * 100)}
								aria-valuemin={18}
								aria-valuemax={80}
								tabIndex={0}
								onPointerDown={startResize}
								onDoubleClick={() => setShare(0.45)}
								onKeyDown={(e) => {
									if (e.key === "ArrowUp") setShare(editorShare - 0.04);
									if (e.key === "ArrowDown") setShare(editorShare + 0.04);
								}}
								className="group/split relative z-10 -my-[3px] h-[7px] shrink-0 cursor-row-resize outline-none"
							>
								<div className="absolute inset-x-0 top-[3px] h-px bg-border transition-colors group-hover/split:bg-border-strong group-focus-visible/split:bg-ring" />
							</div>
						) : (
							<div className="h-px bg-border" />
						)}

						<div className="flex min-h-[420px] flex-1 flex-col lg:min-h-0">
							<ResultsPanel
								run={current?.run ?? null}
								pending={isPending}
								pendingSince={isPending ? (pending?.since ?? null) : null}
								onShowError={(entry) => markError(entry, current?.doc ?? "")}
								aiEnabled={aiEnabled}
								activeTab={current?.active ?? 0}
								onActiveTabChange={(tab) =>
									setResults((map) => ({
										...map,
										[active.id]: { ...(map[active.id] ?? { run: null, doc: "" }), active: tab },
									}))
								}
								exportName={`${databaseName}-${active.title.replace(/\W+/g, "-").toLowerCase()}`}
							/>
						</div>
					</div>
				</div>
			</div>

			{!desktop && (
				<Sheet open={explorerSheet} onOpenChange={setExplorerSheet}>
					<SheetContent side="left" className="w-[88vw] max-w-sm gap-0 p-0" showCloseButton={false}>
						<SheetHeader className="sr-only">
							<SheetTitle>Schema</SheetTitle>
							<SheetDescription>Tables, columns, indexes and foreign keys</SheetDescription>
						</SheetHeader>
						{explorer}
					</SheetContent>
				</Sheet>
			)}

			<ConfirmDestructive pending={confirm} onClose={() => setConfirm(null)} />
			<DdlDialog
				state={ddl}
				onClose={() => setDdl(null)}
				onOpenInTab={(sql, title) => openTab(sql, title)}
			/>
		</div>
	);
}

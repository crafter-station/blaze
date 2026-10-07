"use client";

import {
	Bookmark,
	ChevronDown,
	Command as CommandIcon,
	FilePlus2,
	Gauge,
	History,
	Keyboard,
	ListTree,
	Loader2,
	Network,
	PanelLeft,
	PanelLeftClose,
	Play,
	PlayCircle,
	Plus,
	Save,
	Sparkles,
	WandSparkles,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { format as formatSql } from "sql-formatter";
import {
	deleteSavedQueryAction,
	explainAction,
	introspectAction,
	listSavedQueriesAction,
	runSqlAction,
	saveQueryAction,
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
import type { SavedQueryView } from "@/lib/saved-queries";
import { detectDestructive, isReadOnlyQuery } from "@/lib/sql/destructive";
import { DIALECTS, qualifiedName } from "@/lib/sql/dialect";
import { locateError } from "@/lib/sql/error-position";
import { normalizePlan, supportsAnalyze } from "@/lib/sql/explain";
import { type Statement, splitStatements, statementAt, statementsInRange } from "@/lib/sql/split";
import type { SchemaSnapshot, SchemaTable, SqlEngine } from "@/lib/sql/types";
import { cn } from "@/lib/utils";
import { AssistantPanel, type AssistantTrigger } from "./assistant-panel";
import {
	ConfirmAnalyze,
	ConfirmDelete,
	ConfirmDestructive,
	DdlDialog,
	NameDialog,
	type PendingConfirmation,
} from "./dialogs";
import { type EditorApi, type EditorError, type EditorHandlers, SqlCodeEditor } from "./editor";
import { type ExplainState, ExplainView } from "./explain-view";
import { clearHistory, type HistoryEntry, pushHistory, readHistory } from "./history";
import { formatMs, isMacPlatform, useMediaQuery } from "./hooks";
import { QueryHistory, SavedQueries } from "./library";
import { CommandPalette, type PaletteAction, ShortcutsDialog } from "./palette";
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
	/** Set when the tab holds a saved query; Save then updates it in place. */
	savedId?: string;
	/** SQL as last saved, to show unsaved changes. */
	savedSql?: string;
}

type SidePanel = "schema" | "saved" | "history";

interface TabResults {
	run: RunRecord | null;
	active: number | string;
	/** Document text at the time of the run, to map error offsets after edits. */
	doc: string;
	explain?: ExplainState & { from: number; to: number; doc: string; errorPosition?: number };
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
					.map((t) => ({
						id: String(t.id),
						title: String(t.title || "Query"),
						sql: t.sql,
						savedId: typeof t.savedId === "string" ? t.savedId : undefined,
						savedSql: typeof t.savedSql === "string" ? t.savedSql : undefined,
					}));
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

	const openTab = useCallback((sql: string, title?: string, saved?: SavedQueryView) => {
		const id = newTabId();
		setTabs((list) => {
			const n = list.length + 1;
			const tab: QueryTab = {
				id,
				title: title ?? `Query ${n}`,
				sql,
				savedId: saved?.id,
				savedSql: saved?.sql,
			};
			return [...list, tab].slice(-20);
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

	/* ---------------- saved queries and history ---------------- */

	const [saved, setSaved] = useState<SavedQueryView[] | null>(null);
	const [savedLoading, setSavedLoading] = useState(false);
	const [savedError, setSavedError] = useState<string | null>(null);
	const [history, setHistory] = useState<HistoryEntry[]>([]);
	const [panel, setPanel] = useState<SidePanel>("schema");
	const [nameDialog, setNameDialog] = useState<{
		title: string;
		action: string;
		initial: string;
		submit: (name: string) => Promise<string | null>;
	} | null>(null);
	const [deleting, setDeleting] = useState<SavedQueryView | null>(null);

	useEffect(() => {
		setHistory(readHistory(databaseId));
	}, [databaseId]);

	const loadSaved = useCallback(async () => {
		setSavedLoading(true);
		try {
			const result = await listSavedQueriesAction(databaseId);
			if (result.ok) {
				setSaved(result.queries);
				setSavedError(null);
			} else setSavedError(result.error);
		} catch {
			setSavedError("Could not load saved queries");
		} finally {
			setSavedLoading(false);
		}
	}, [databaseId]);

	useEffect(() => {
		void loadSaved();
	}, [loadSaved]);

	const openSaved = useCallback(
		(query: SavedQueryView) => {
			const existing = tabs.find((t) => t.savedId === query.id);
			if (existing) setActiveId(existing.id);
			else openTab(query.sql, query.name, query);
		},
		[tabs, openTab],
	);

	const persist = useCallback(
		async (tab: QueryTab, name: string, id?: string): Promise<string | null> => {
			const result = await saveQueryAction(databaseId, { id, name, sql: tab.sql });
			if (!result.ok) return result.error;
			const query = result.query;
			setTabs((list) =>
				list.map((t) =>
					t.id === tab.id ? { ...t, title: query.name, savedId: query.id, savedSql: query.sql } : t,
				),
			);
			setSaved((list) => [query, ...(list ?? []).filter((q) => q.id !== query.id)]);
			toast.success(id ? `Saved “${query.name}”` : `Saved as “${query.name}”`);
			return null;
		},
		[databaseId],
	);

	const save = useCallback(() => {
		const tab = tabs.find((t) => t.id === activeIdRef.current);
		if (!tab) return;
		if (!tab.sql.trim()) {
			toast.message("Nothing to save", { description: "Write some SQL first." });
			return;
		}
		if (tab.savedId) {
			void persist(tab, tab.title, tab.savedId).then((error) => error && toast.error(error));
			return;
		}
		setNameDialog({
			title: "Save query",
			action: "Save",
			initial: /^Query \d+$/.test(tab.title) ? "" : tab.title,
			submit: (name) => persist(tab, name),
		});
	}, [tabs, persist]);

	const rename = useCallback(
		(query: SavedQueryView) =>
			setNameDialog({
				title: "Rename saved query",
				action: "Rename",
				initial: query.name,
				submit: async (name) => {
					const result = await saveQueryAction(databaseId, { id: query.id, name, sql: query.sql });
					if (!result.ok) return result.error;
					setSaved((list) => (list ?? []).map((q) => (q.id === query.id ? result.query : q)));
					setTabs((list) => list.map((t) => (t.savedId === query.id ? { ...t, title: name } : t)));
					return null;
				},
			}),
		[databaseId],
	);

	const remove = useCallback(
		async (query: SavedQueryView) => {
			const result = await deleteSavedQueryAction(databaseId, query.id);
			if (!result.ok) {
				toast.error(result.error);
				return;
			}
			setSaved((list) => (list ?? []).filter((q) => q.id !== query.id));
			setTabs((list) =>
				list.map((t) =>
					t.savedId === query.id ? { ...t, savedId: undefined, savedSql: undefined } : t,
				),
			);
			toast.success(`Deleted “${query.name}”`);
		},
		[databaseId],
	);

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

			if (record.entries.length > 0) {
				const lastRows = [...record.entries].reverse().find((e) => e.outcome.columns.length > 0);
				setHistory(
					pushHistory(databaseId, {
						id: record.id,
						sql: statements.map((s) => s.text).join(";\n"),
						at: startedAt,
						durationMs: (record.finishedAt ?? startedAt) - startedAt,
						ok: failed === -1,
						statements: statements.length,
						rows: lastRows?.outcome.rowCount,
						error: failed === -1 ? undefined : record.entries[failed].outcome.error,
					}),
				);
			}

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

	/* ---------------- EXPLAIN ---------------- */

	const [analyzeConfirm, setAnalyzeConfirm] = useState<{
		statement: string;
		run: () => void;
	} | null>(null);

	const runExplain = useCallback(
		async (statement: Statement, analyze: boolean, tabId: string, doc: string) => {
			const base = { statement: statement.text, from: statement.from, to: statement.to, doc };
			setResults((map) => ({
				...map,
				[tabId]: {
					...(map[tabId] ?? { run: null, doc }),
					active: "plan",
					explain: { ...base, status: "loading", analyzed: analyze },
				},
			}));
			setPending({ tabId, since: Date.now() });
			let explain: NonNullable<TabResults["explain"]>;
			try {
				const result = await explainAction(databaseId, statement.text, analyze);
				if (result.ok) {
					try {
						const tree = normalizePlan(result.format, result.raw);
						explain = {
							...base,
							status: "done",
							analyzed: result.analyzed,
							tree,
							raw: result.raw,
							durationMs: result.durationMs,
						};
					} catch {
						explain = {
							...base,
							status: "error",
							analyzed: analyze,
							raw: result.raw,
							error: "The engine returned a plan this console could not read.",
						};
					}
				} else {
					explain = {
						...base,
						status: "error",
						analyzed: analyze,
						error: result.error,
						errorPosition: result.errorPosition,
					};
				}
			} catch {
				explain = {
					...base,
					status: "error",
					analyzed: analyze,
					error: "Could not reach the server.",
				};
			}
			setPending(null);
			setResults((map) => ({
				...map,
				[tabId]: { ...(map[tabId] ?? { run: null, doc }), active: "plan", explain },
			}));
			if (explain.status === "error" && tabId === activeIdRef.current) {
				markError(
					{
						text: explain.statement,
						from: explain.from,
						to: explain.to,
						outcome: {
							ok: false,
							error: explain.error,
							errorPosition: explain.errorPosition,
							columns: [],
							rows: [],
							rowCount: 0,
							truncated: false,
							durationMs: 0,
						},
					},
					doc,
				);
			}
		},
		[databaseId, markError],
	);

	const explain = useCallback(
		(analyze: boolean) => {
			if (pending) return;
			const statements = collect("cursor");
			if (statements.length !== 1) {
				toast.message(
					statements.length === 0 ? "Nothing to explain" : "Explain one statement at a time",
					{
						description: "Put the cursor in a statement, or select exactly one.",
					},
				);
				return;
			}
			const [statement] = statements;
			const tabId = activeIdRef.current;
			const doc = apiRef.current?.getDoc() ?? "";
			const go = () => void runExplain(statement, analyze && supportsAnalyze(engine), tabId, doc);
			if (analyze && supportsAnalyze(engine) && !isReadOnlyQuery(statement.text, engine)) {
				setAnalyzeConfirm({ statement: statement.text, run: go });
				return;
			}
			go();
		},
		[pending, collect, runExplain, engine],
	);

	/* ---------------- assistant ---------------- */

	const [assistantOpen, setAssistantOpen] = useState(false);
	const [assistantTrigger, setAssistantTrigger] = useState<AssistantTrigger | null>(null);

	// A closed panel has no pending request; reopening it must not replay the last one.
	useEffect(() => {
		if (!assistantOpen) setAssistantTrigger(null);
	}, [assistantOpen]);

	const askClaude = useCallback((mode: AssistantTrigger["mode"], sql?: string, error?: string) => {
		setAssistantOpen(true);
		setAssistantTrigger({ mode, sql, error, nonce: Date.now() });
	}, []);

	const statementText = useCallback(
		() =>
			collect("cursor")
				.map((s) => s.text)
				.join(";\n"),
		[collect],
	);

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
		explain: () => explain(false),
		format,
		save,
		palette: () => setPaletteOpen(true),
	};

	/* ---------------- palette and global shortcuts ---------------- */

	const [paletteOpen, setPaletteOpen] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);

	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			const mod = isMacPlatform() ? event.metaKey : event.ctrlKey;
			if (mod && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen((open) => !open);
				return;
			}
			const target = event.target as HTMLElement | null;
			const typing =
				target?.closest(".cm-editor") ||
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable;
			if (!typing && event.key === "?" && !mod) {
				event.preventDefault();
				setShortcutsOpen(true);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	/* ---------------- explorer actions ---------------- */

	const [ddl, setDdl] = useState<{
		title: string;
		ddl: string | null;
		error: string | null;
	} | null>(null);
	const [explorerOpen, setExplorerOpen] = useState(true);
	const [explorerSheet, setExplorerSheet] = useState(false);

	const showPanel = useCallback(
		(next: SidePanel) => {
			setPanel(next);
			if (desktop) setExplorerOpen(true);
			else setExplorerSheet(true);
		},
		[desktop],
	);

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
	const key = mod.replace("+", "");
	const panels: { id: SidePanel; label: string; icon: typeof ListTree }[] = [
		{ id: "schema", label: "Schema", icon: ListTree },
		{ id: "saved", label: "Saved", icon: Bookmark },
		{ id: "history", label: "History", icon: History },
	];
	const explorer = (
		<div className="flex h-full min-h-0 flex-col">
			<div
				role="tablist"
				aria-label="Side panel"
				className="flex h-10 shrink-0 items-center gap-0.5 border-border border-b px-1.5"
			>
				{panels.map((item) => (
					<button
						key={item.id}
						type="button"
						role="tab"
						aria-selected={panel === item.id}
						onClick={() => setPanel(item.id)}
						className={cn(
							"flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
							panel === item.id
								? "bg-accent font-medium text-foreground"
								: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
						)}
					>
						<item.icon className="size-3.5" />
						{item.label}
					</button>
				))}
			</div>
			{panel === "schema" ? (
				<SchemaExplorer
					databaseId={databaseId}
					engine={engine}
					snapshot={snapshot}
					loading={schemaLoading}
					error={schemaError}
					onRefresh={() => void loadSchema()}
					actions={tableActions}
					className="min-h-0 flex-1"
				/>
			) : panel === "saved" ? (
				<SavedQueries
					queries={saved}
					loading={savedLoading}
					error={savedError}
					activeSavedId={active.savedId}
					onOpen={(query) => {
						openSaved(query);
						setExplorerSheet(false);
					}}
					onRename={rename}
					onDelete={setDeleting}
					saveHint={`${mod}S`}
				/>
			) : (
				<QueryHistory
					entries={history}
					onOpen={(entry) => {
						openTab(`${entry.sql};\n`, "From history");
						setExplorerSheet(false);
					}}
					onClear={() => {
						clearHistory(databaseId);
						setHistory([]);
					}}
				/>
			)}
		</div>
	);

	const paletteActions: PaletteAction[] = [
		{
			id: "run",
			label: "Run statement or selection",
			icon: Play,
			shortcut: `${mod}Enter`,
			run: () => handlers.current.run(),
		},
		{
			id: "run-all",
			label: "Run all statements",
			icon: PlayCircle,
			shortcut: `⇧${mod}Enter`,
			run: () => handlers.current.runAll(),
		},
		{
			id: "explain",
			label: "Explain statement",
			icon: Network,
			shortcut: `⇧${mod}E`,
			keywords: ["plan", "query plan"],
			run: () => explain(false),
		},
		{
			id: "explain-analyze",
			label: "Explain with ANALYZE",
			icon: Gauge,
			keywords: ["plan", "timing", "profile"],
			disabled: !supportsAnalyze(engine),
			run: () => explain(true),
		},
		{
			id: "format",
			label: "Format SQL",
			icon: WandSparkles,
			shortcut: "⇧Alt F",
			keywords: ["prettify", "beautify"],
			run: format,
		},
		{
			id: "save",
			label: active.savedId ? "Save changes" : "Save query",
			icon: Save,
			shortcut: `${mod}S`,
			run: save,
		},
		{ id: "new-tab", label: "New query tab", icon: FilePlus2, run: () => openTab("") },
		{ id: "close-tab", label: "Close this tab", icon: X, run: () => closeTab(active.id) },
		{ id: "schema", label: "Show schema", icon: ListTree, run: () => showPanel("schema") },
		{ id: "saved", label: "Show saved queries", icon: Bookmark, run: () => showPanel("saved") },
		{ id: "history", label: "Show query history", icon: History, run: () => showPanel("history") },
		{
			id: "ask-write",
			label: "Ask Claude to write SQL",
			icon: Sparkles,
			keywords: ["ai", "assistant", "generate", "text to sql"],
			run: () => askClaude("generate"),
		},
		{
			id: "ask-explain",
			label: "Ask Claude to explain this query",
			icon: Sparkles,
			keywords: ["ai", "assistant"],
			run: () => {
				const sql = statementText();
				if (sql.trim()) askClaude("explain", sql);
				else setAssistantOpen(true);
			},
		},
		{
			id: "shortcuts",
			label: "Keyboard shortcuts",
			icon: Keyboard,
			shortcut: "?",
			run: () => setShortcutsOpen(true),
		},
	];

	const shortcutGroups = [
		{
			title: "Run",
			items: [
				{ keys: [key, "Enter"], label: "Run statement at cursor, or the selection" },
				{ keys: ["Shift", key, "Enter"], label: "Run every statement" },
				{ keys: ["Shift", key, "E"], label: "Explain the statement at the cursor" },
			],
		},
		{
			title: "Edit",
			items: [
				{ keys: ["Shift", "Alt", "F"], label: "Format SQL (selection or all)" },
				{ keys: [key, "S"], label: "Save query" },
				{ keys: ["Ctrl", "Space"], label: "Show completions" },
				{ keys: [key, "/"], label: "Toggle comment" },
				{ keys: [key, "F"], label: "Find in editor" },
			],
		},
		{
			title: "Results grid",
			items: [
				{ keys: ["↑", "↓", "←", "→"], label: "Move between cells (Shift extends)" },
				{ keys: [key, "C"], label: "Copy selection as TSV" },
				{ keys: [key, "A"], label: "Select every cell" },
				{ keys: ["Enter"], label: "Inspect the focused row" },
			],
		},
		{
			title: "Console",
			items: [
				{ keys: [key, "K"], label: "Command palette" },
				{ keys: ["?"], label: "This list" },
			],
		},
	];

	const assistant = (
		<AssistantPanel
			databaseId={databaseId}
			enabled={aiEnabled}
			trigger={assistantTrigger}
			getEditorSql={() => apiRef.current?.getDoc() ?? ""}
			getStatementSql={statementText}
			onInsert={(sql) => {
				apiRef.current?.insert(sql);
				if (!desktop) setAssistantOpen(false);
			}}
			onReplace={(sql) => {
				if (!desktop) setAssistantOpen(false);
				apiRef.current?.replaceAll(`${sql}\n`);
			}}
			onOpenTab={(sql) => {
				if (!desktop) setAssistantOpen(false);
				openTab(`${sql}\n`, "From Claude");
			}}
			onClose={() => setAssistantOpen(false)}
			className="h-full"
		/>
	);

	return (
		<div className="flex flex-col lg:h-[calc(100dvh-3.5rem)]">
			<div className="flex min-h-0 flex-1">
				{desktop && explorerOpen && (
					<aside
						aria-label="Schema, saved queries and history"
						className="w-[272px] shrink-0 border-border border-r bg-sidebar"
					>
						{explorer}
					</aside>
				)}

				<div className="flex min-w-0 flex-1 flex-col">
					{/* Tabs and toolbar stay reachable while the page scrolls on small screens. */}
					<div className="sticky top-14 z-20 lg:static">
						{/* Tab strip */}
						<div className="flex h-10 shrink-0 items-center gap-1 border-border border-b bg-background pr-2 pl-1.5">
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => (desktop ? setExplorerOpen((v) => !v) : setExplorerSheet(true))}
								aria-label={desktop && explorerOpen ? "Hide side panel" : "Show side panel"}
								title={desktop && explorerOpen ? "Hide side panel" : "Show side panel"}
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
												{tab.savedId && <Bookmark className="size-3 shrink-0" aria-hidden="true" />}
												<span className="truncate">{tab.title}</span>
												{tab.savedId && tab.savedSql !== tab.sql && (
													<span
														className="size-1.5 shrink-0 rounded-full bg-foreground/50"
														title="Unsaved changes"
													>
														<span className="sr-only">(unsaved changes)</span>
													</span>
												)}
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
						<div className="@container flex h-11 shrink-0 items-center gap-1 overflow-hidden border-border border-b bg-card px-2">
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
							<div className="flex items-center">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => explain(false)}
									disabled={!!pending}
									className="rounded-r-none"
									title={`Explain the statement at the cursor (⇧${mod}E)`}
									aria-label="Explain statement"
								>
									<Network data-icon="inline-start" />
									<span className="hidden @lg:inline">Explain</span>
								</Button>
								{supportsAnalyze(engine) && (
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="ghost"
												size="icon-sm"
												disabled={!!pending}
												className="-ml-0.5 rounded-l-none"
												aria-label="More explain options"
											>
												<ChevronDown />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="start" className="min-w-64">
											<DropdownMenuItem onSelect={() => explain(false)}>
												<Network className="text-muted-foreground" />
												Explain (plan only)
												<DropdownMenuShortcut>⇧{mod}E</DropdownMenuShortcut>
											</DropdownMenuItem>
											<DropdownMenuItem onSelect={() => explain(true)}>
												<Gauge className="text-muted-foreground" />
												Explain with ANALYZE (runs it)
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								)}
							</div>
							<Button
								variant="ghost"
								size="sm"
								onClick={format}
								title="Format SQL (Shift+Alt+F)"
								aria-label="Format SQL"
							>
								<WandSparkles data-icon="inline-start" />
								<span className="hidden @2xl:inline">Format</span>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={save}
								title={`Save query (${mod}S)`}
								aria-label={active.savedId ? "Save query" : "Save query as"}
							>
								<Save data-icon="inline-start" />
								<span className="hidden @2xl:inline">{active.savedId ? "Save" : "Save as…"}</span>
							</Button>
							<p className="ml-auto hidden truncate text-[0.6875rem] text-muted-foreground @6xl:block">
								Runs as <span className="font-mono text-foreground/80">{roleName}</span> ·{" "}
								{timeoutSeconds}s timeout · first {maxRows} rows
							</p>
							<Button
								variant={assistantOpen ? "secondary" : "ghost"}
								size="sm"
								className="ml-auto @6xl:ml-0"
								onClick={() => setAssistantOpen((open) => !open)}
								aria-pressed={assistantOpen}
								aria-label="Ask Claude"
								title={aiEnabled ? "Ask Claude" : "Ask Claude (not configured on this server)"}
							>
								<Sparkles
									data-icon="inline-start"
									className={aiEnabled ? "text-brand-text" : undefined}
								/>
								<span className="hidden @xl:inline">Ask Claude</span>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="text-muted-foreground"
								onClick={() => setPaletteOpen(true)}
								aria-label="Open command palette"
							>
								<CommandIcon data-icon="inline-start" />
								<span className="hidden @3xl:inline">Commands</span>
								<kbd className="ml-1 hidden rounded-sm bg-muted px-1 font-sans text-[0.6875rem] @3xl:inline">
									{mod}K
								</kbd>
							</Button>
						</div>
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
								wrap={!desktop}
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
								onFixError={(entry) => askClaude("fix", entry.text, entry.outcome.error)}
								aiEnabled={aiEnabled}
								activeTab={current?.active ?? 0}
								onActiveTabChange={(tab) =>
									setResults((map) => ({
										...map,
										[active.id]: { ...(map[active.id] ?? { run: null, doc: "" }), active: tab },
									}))
								}
								exportName={`${databaseName}-${active.title.replace(/\W+/g, "-").toLowerCase()}`}
								extraTab={
									current?.explain
										? {
												id: "plan",
												footer:
													current.explain.status === "done" &&
													current.explain.durationMs !== undefined ? (
														<span className="font-mono tabular-nums">
															{current.explain.analyzed ? "Executed and planned" : "Planned"} in{" "}
															{formatMs(current.explain.durationMs)}
															{current.explain.analyzed ? " · changes rolled back" : ""}
														</span>
													) : undefined,
												label: (
													<>
														<Network className="size-3.5" />
														{current.explain.analyzed ? "Plan (analyzed)" : "Plan"}
													</>
												),
												content: (
													<ExplainView
														state={current.explain}
														canAnalyze={supportsAnalyze(engine)}
														onAnalyze={() => {
															const plan = current.explain;
															if (!plan) return;
															const statement = {
																text: plan.statement,
																from: plan.from,
																to: plan.to,
																end: plan.to,
															};
															const go = () =>
																void runExplain(statement, true, active.id, plan.doc);
															if (!isReadOnlyQuery(plan.statement, engine)) {
																setAnalyzeConfirm({ statement: plan.statement, run: go });
															} else go();
														}}
														onShowError={() =>
															current.explain
																? markError(
																		{
																			text: current.explain.statement,
																			from: current.explain.from,
																			to: current.explain.to,
																			outcome: {
																				ok: false,
																				error: current.explain.error,
																				errorPosition: current.explain.errorPosition,
																				columns: [],
																				rows: [],
																				rowCount: 0,
																				truncated: false,
																				durationMs: 0,
																			},
																		},
																		current.explain.doc,
																	)
																: false
														}
													/>
												),
											}
										: null
								}
							/>
						</div>
					</div>
				</div>
				{desktop && assistantOpen && (
					<aside className="w-[min(400px,34%)] shrink-0 border-border border-l">{assistant}</aside>
				)}
			</div>

			{!desktop && (
				<Sheet open={assistantOpen} onOpenChange={setAssistantOpen}>
					<SheetContent side="bottom" className="h-[88dvh] gap-0 p-0" showCloseButton={false}>
						<SheetHeader className="sr-only">
							<SheetTitle>Ask Claude</SheetTitle>
							<SheetDescription>Write, explain or fix SQL with Claude</SheetDescription>
						</SheetHeader>
						{assistant}
					</SheetContent>
				</Sheet>
			)}

			{!desktop && (
				<Sheet open={explorerSheet} onOpenChange={setExplorerSheet}>
					<SheetContent side="left" className="w-[88vw] max-w-sm gap-0 p-0" showCloseButton={false}>
						<SheetHeader className="sr-only">
							<SheetTitle>Schema, saved queries and history</SheetTitle>
							<SheetDescription>Tables, columns, saved queries and recent runs</SheetDescription>
						</SheetHeader>
						{explorer}
					</SheetContent>
				</Sheet>
			)}

			<ConfirmDestructive pending={confirm} onClose={() => setConfirm(null)} />
			<ConfirmAnalyze
				statement={analyzeConfirm?.statement ?? null}
				engine={engine}
				onClose={() => setAnalyzeConfirm(null)}
				onConfirm={() => analyzeConfirm?.run()}
			/>
			<NameDialog
				state={nameDialog}
				onClose={() => setNameDialog(null)}
				onSubmit={(name) => nameDialog?.submit(name) ?? Promise.resolve(null)}
			/>
			<ConfirmDelete
				name={deleting?.name ?? null}
				onClose={() => setDeleting(null)}
				onConfirm={() => deleting && void remove(deleting)}
			/>
			<CommandPalette
				open={paletteOpen}
				onOpenChange={setPaletteOpen}
				actions={paletteActions}
				tables={snapshot?.tables ?? []}
				saved={saved ?? []}
				history={history}
				onPreviewTable={tableActions.selectStar}
				onOpenSaved={openSaved}
				onOpenHistory={(entry) => openTab(`${entry.sql};\n`, "From history")}
			/>
			<ShortcutsDialog
				open={shortcutsOpen}
				onOpenChange={setShortcutsOpen}
				groups={shortcutGroups}
			/>
			<DdlDialog
				state={ddl}
				onClose={() => setDdl(null)}
				onOpenInTab={(sql, title) => openTab(sql, title)}
			/>
		</div>
	);
}

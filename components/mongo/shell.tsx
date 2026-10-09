"use client";

import { completionStatus } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import {
	Ban,
	BookOpen,
	Braces,
	ChevronRight,
	CircleAlert,
	ClipboardCopy,
	Command as CommandIcon,
	Eraser,
	FilePlus2,
	FolderTree,
	History,
	Info,
	Keyboard,
	ListTree,
	Loader2,
	PanelLeft,
	PanelLeftClose,
	Play,
	RotateCcw,
	Sparkles,
	Table2,
	Terminal,
	TriangleAlert,
	X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	mongoShellContextAction,
	runMongoShellAction,
} from "@/app/(dashboard)/databases/[id]/console/mongo-actions";
import { AssistantPanel, type AssistantTrigger } from "@/components/console-shell/assistant-panel";
import { DataGrid } from "@/components/console-shell/data-grid";
import { formatMs, isMacPlatform, useMediaQuery } from "@/components/console-shell/hooks";
import { HistoryList } from "@/components/console-shell/library";
import {
	CommandPalette,
	type PaletteAction,
	ShortcutsDialog,
} from "@/components/console-shell/palette";
import { SegmentedTabs, TabStrip } from "@/components/console-shell/tab-strip";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { classify } from "@/lib/mongo/classify";
import { type CompletionContext, collectionInStatement } from "@/lib/mongo/completion";
import {
	bsonTypeOf,
	type EJsonValue,
	isObject,
	LiteralParseError,
	toShell,
} from "@/lib/mongo/literal";
import { topLevelColumns } from "@/lib/mongo/schema";
import { parseShell } from "@/lib/mongo/shell";
import type { ShellOutcome, ShellResult } from "@/lib/mongo/types";
import { cn } from "@/lib/utils";
import { CodeEditor, type CodeEditorApi } from "./code-editor";
import { ConfirmDialog, type ConfirmState } from "./dialogs";
import { cellText, DocumentTree, isContainer, TypedValue } from "./document-view";
import {
	clearMongoHistory,
	type MongoHistoryEntry,
	pushMongoHistory,
	readMongoHistory,
} from "./history";
import { MongoReference } from "./reference";

/**
 * The Mongo Shell: mongosh's syntax for one database, parsed rather than evaluated.
 *
 * Each tab is a session with its own input and transcript. A run sends the command to the
 * server, which parses it again (lib/mongo/shell.ts), classifies it and runs it as the
 * tenant's own user. Documents render as collapsible trees or a table; a few commands ask
 * first, and a few (change streams, tailable cursors) are refused with a reason.
 */

export interface MongoShellProps {
	databaseId: string;
	databaseName: string;
	dbName: string;
	user: string;
	timeoutSeconds: number;
	maxDocs: number;
	aiEnabled: boolean;
	suspended: boolean;
}

interface SessionTab {
	id: string;
	title: string;
	input: string;
}

interface Block {
	id: string;
	source: string;
	at: number;
	pending: boolean;
	outcome?: ShellOutcome;
}

type SidePanel = "history" | "reference";

const transcripts = new Map<string, Record<string, Block[]>>();
const storageKey = (databaseId: string) => `blaze.mongo.tabs.${databaseId}`;
const newId = () => Math.random().toString(36).slice(2, 10);

function readTabs(databaseId: string): { tabs: SessionTab[]; activeId: string } {
	try {
		const raw = localStorage.getItem(storageKey(databaseId));
		if (raw) {
			const parsed = JSON.parse(raw) as { tabs: SessionTab[]; activeId: string };
			const tabs = (Array.isArray(parsed.tabs) ? parsed.tabs : [])
				.filter((t) => t && typeof t.input === "string")
				.slice(0, 20)
				.map((t) => ({ id: String(t.id), title: String(t.title || "Session"), input: t.input }));
			if (tabs.length) {
				return {
					tabs,
					activeId: tabs.some((t) => t.id === parsed.activeId) ? parsed.activeId : tabs[0].id,
				};
			}
		}
	} catch {}
	const id = newId();
	return { tabs: [{ id, title: "Session 1", input: "" }], activeId: id };
}

function examples(collections: string[]): string[] {
	const pick = (name: string) => collections.find((c) => c === name);
	const first = collections.find((c) => !c.startsWith("_")) ?? "collection";
	const ref = (c: string) =>
		/^[A-Za-z_$][\w$]*$/.test(c) ? `db.${c}` : `db.getCollection(${JSON.stringify(c)})`;
	if (pick("orders")) {
		return [
			"show collections",
			"db.orders.find({ status: 'paid' }).sort({ placedAt: -1 }).limit(5)",
			"db.orders.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }, { $sort: { n: -1 } }])",
			"db.orders.countDocuments({ total: { $gt: 500 } })",
		];
	}
	return [
		"show collections",
		`${ref(first)}.find().limit(5)`,
		`${ref(first)}.getIndexes()`,
		"db.stats()",
	];
}

export function MongoShell(props: MongoShellProps) {
	const { databaseId, databaseName, dbName, user, timeoutSeconds, maxDocs, aiEnabled, suspended } =
		props;
	const desktop = useMediaQuery("(min-width: 1024px)");
	const mod = isMacPlatform() ? "⌘" : "Ctrl+";
	const modKey = mod.replace("+", "");
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	/* ---------------- context: collections and field paths ---------------- */

	const completion = useRef<CompletionContext>({ collections: [] });
	const [collections, setCollections] = useState<string[]>([]);
	const loadContext = useCallback(async () => {
		try {
			const result = await mongoShellContextAction(databaseId);
			if (!result.ok) return;
			setCollections(result.collections);
			completion.current = {
				collections: result.collections,
				fields: Object.fromEntries(
					result.shapes.map((shape) => [shape.name, shape.fields.map((f) => f.path)]),
				),
			};
		} catch {}
	}, [databaseId]);
	useEffect(() => {
		void loadContext();
	}, [loadContext]);

	/* ---------------- sessions ---------------- */

	const [tabs, setTabs] = useState<SessionTab[]>([
		{ id: "initial", title: "Session 1", input: "" },
	]);
	const [activeId, setActiveId] = useState("initial");
	const [hydrated, setHydrated] = useState(false);
	const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
	const activeIdRef = useRef(activeId);
	activeIdRef.current = activeId;

	const [blocks, setBlocksState] = useState<Record<string, Block[]>>(
		() => transcripts.get(databaseId) ?? {},
	);
	const setBlocks = useCallback(
		(update: (map: Record<string, Block[]>) => Record<string, Block[]>) => {
			setBlocksState((map) => {
				const next = update(map);
				transcripts.set(databaseId, next);
				return next;
			});
		},
		[databaseId],
	);

	useEffect(() => {
		const stored = readTabs(databaseId);
		setTabs(stored.tabs);
		setActiveId(stored.activeId);
		setHydrated(true);
	}, [databaseId]);

	useEffect(() => {
		if (!hydrated) return;
		const timer = setTimeout(() => {
			try {
				localStorage.setItem(storageKey(databaseId), JSON.stringify({ tabs, activeId }));
			} catch {}
		}, 300);
		return () => clearTimeout(timer);
	}, [tabs, activeId, hydrated, databaseId]);

	const apiRef = useRef<CodeEditorApi | null>(null);

	const openTab = useCallback((input = "", title?: string) => {
		const id = newId();
		setTabs((list) =>
			[...list, { id, title: title ?? `Session ${list.length + 1}`, input }].slice(-20),
		);
		setActiveId(id);
		return id;
	}, []);

	const closeTab = useCallback(
		(id: string) => {
			const at = tabs.findIndex((t) => t.id === id);
			if (at === -1) return;
			if (tabs.length === 1) {
				const fresh = { id: newId(), title: "Session 1", input: "" };
				setTabs([fresh]);
				setActiveId(fresh.id);
			} else {
				const next = tabs.filter((t) => t.id !== id);
				setTabs(next);
				if (id === activeId) setActiveId(next[Math.max(0, at - 1)].id);
			}
			setBlocks((map) => {
				const copy = { ...map };
				delete copy[id];
				return copy;
			});
		},
		[tabs, activeId, setBlocks],
	);

	const setInput = useCallback(
		(input: string) =>
			setTabs((list) => list.map((t) => (t.id === activeIdRef.current ? { ...t, input } : t))),
		[],
	);

	// "Open in shell" from the Browser arrives as ?cmd=…: it lands in the input, not run.
	const handledCmd = useRef<string | null>(null);
	useEffect(() => {
		const cmd = searchParams.get("cmd");
		if (!hydrated || !cmd || handledCmd.current === cmd) return;
		handledCmd.current = cmd;
		const current = tabs.find((t) => t.id === activeIdRef.current);
		if (current && !current.input.trim()) {
			setInput(cmd);
			apiRef.current?.setDoc(cmd);
		} else openTab(cmd, "From Browser");
		router.replace(pathname, { scroll: false });
		setTimeout(() => apiRef.current?.focus(), 50);
	}, [hydrated, searchParams, tabs, setInput, openTab, router, pathname]);

	/* ---------------- history ---------------- */

	const [history, setHistory] = useState<MongoHistoryEntry[]>([]);
	useEffect(() => setHistory(readMongoHistory(databaseId)), [databaseId]);
	const historyCursor = useRef<{ index: number; draft: string }>({ index: -1, draft: "" });

	/* ---------------- running ---------------- */

	const [pending, setPending] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<ConfirmState | null>(null);
	const transcriptRef = useRef<HTMLDivElement>(null);

	const scrollToEnd = useCallback(() => {
		requestAnimationFrame(() => {
			const el = transcriptRef.current;
			if (el) el.scrollTop = el.scrollHeight;
		});
	}, []);

	const execute = useCallback(
		async (source: string, confirmed: boolean | string, fromInput: boolean) => {
			const tabId = activeIdRef.current;
			const id = newId();
			const startedAt = Date.now();
			setBlocks((map) => ({
				...map,
				[tabId]: [...(map[tabId] ?? []), { id, source, at: startedAt, pending: true }].slice(-200),
			}));
			setPending(tabId);
			if (fromInput) {
				setInput("");
				apiRef.current?.setDoc("");
			}
			historyCursor.current = { index: -1, draft: "" };
			scrollToEnd();

			let outcome: ShellOutcome;
			try {
				const result = await runMongoShellAction(databaseId, source, confirmed);
				outcome =
					"durationMs" in result
						? result
						: { source, ok: false, kind: "connection", error: result.error, durationMs: 0 };
			} catch {
				outcome = {
					source,
					ok: false,
					kind: "connection",
					error: "Could not reach the server. Check your connection and try again.",
					durationMs: Date.now() - startedAt,
				};
			}
			setPending(null);
			setBlocks((map) => ({
				...map,
				[tabId]: (map[tabId] ?? []).map((b) =>
					b.id === id ? { ...b, pending: false, outcome } : b,
				),
			}));
			setHistory(
				pushMongoHistory(databaseId, {
					id,
					text: source,
					at: startedAt,
					durationMs: Date.now() - startedAt,
					ok: outcome.ok,
				}),
			);
			scrollToEnd();
			// Collections may have appeared or gone: refresh what completion knows.
			if (
				outcome.ok &&
				outcome.label &&
				!/\.(find|findOne|count|distinct|aggregate)/.test(outcome.label)
			) {
				void loadContext();
			}
		},
		[databaseId, setBlocks, setInput, scrollToEnd, loadContext],
	);

	const run = useCallback(
		(text?: string) => {
			if (pending) return;
			const source = (text ?? apiRef.current?.getDoc() ?? "").trim();
			if (!source) {
				apiRef.current?.focus();
				return;
			}
			const fromInput = text === undefined;
			try {
				const verdict = classify(parseShell(source), dbName);
				if (verdict.confirm && !verdict.blocked) {
					const typed = verdict.confirm.typeToConfirm;
					setConfirm({
						title: typed ? "Delete the whole database?" : "This command changes data in bulk",
						description: verdict.confirm.message,
						detail: (
							<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-destructive/25 bg-[var(--code-background)] px-3 py-2 font-mono text-xs leading-relaxed">
								{source.length > 1200 ? `${source.slice(0, 1200)}…` : source}
							</pre>
						),
						confirmLabel: typed ? "Drop database" : "Run anyway",
						typeToConfirm: typed,
						run: async () => {
							void execute(source, typed ?? true, fromInput);
							return null;
						},
					});
					return;
				}
			} catch (error) {
				if (!(error instanceof LiteralParseError)) throw error;
				// The server reports the parse error in the transcript, with its position.
			}
			void execute(source, false, fromInput);
		},
		[pending, execute, dbName],
	);

	const clearOutput = useCallback(() => {
		setBlocks((map) => ({ ...map, [activeIdRef.current]: [] }));
	}, [setBlocks]);

	/* ---------------- panels, palette, shortcuts ---------------- */

	const [panel, setPanel] = useState<SidePanel>("history");
	const [sideOpen, setSideOpen] = useState(true);
	const [sideSheet, setSideSheet] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);

	const showPanel = useCallback(
		(next: SidePanel) => {
			setPanel(next);
			if (desktop) setSideOpen(true);
			else setSideSheet(true);
		},
		[desktop],
	);

	const insertText = useCallback((text: string) => {
		const doc = apiRef.current?.getDoc() ?? "";
		if (
			!doc.trim() ||
			text.startsWith("db.") ||
			text.startsWith("show") ||
			text.startsWith("{ ping")
		) {
			apiRef.current?.setDoc(text);
		} else apiRef.current?.insert(text);
		setSideSheet(false);
		setTimeout(() => apiRef.current?.focus(), 0);
	}, []);

	const keys = useRef<Record<string, (view: EditorView) => boolean>>({});
	keys.current = {
		ArrowUp: (view) => {
			if (completionStatus(view.state) === "active") return false;
			const head = view.state.selection.main.head;
			if (view.state.doc.lineAt(head).number !== 1 || history.length === 0) return false;
			const cursor = historyCursor.current;
			if (cursor.index === -1) cursor.draft = view.state.doc.toString();
			if (cursor.index >= history.length - 1) return true;
			cursor.index++;
			apiRef.current?.setDoc(history[cursor.index].text);
			return true;
		},
		ArrowDown: (view) => {
			if (completionStatus(view.state) === "active") return false;
			const head = view.state.selection.main.head;
			if (view.state.doc.lineAt(head).number !== view.state.doc.lines) return false;
			const cursor = historyCursor.current;
			if (cursor.index === -1) return false;
			cursor.index--;
			apiRef.current?.setDoc(cursor.index === -1 ? cursor.draft : history[cursor.index].text);
			return true;
		},
		"Mod-l": () => {
			clearOutput();
			return true;
		},
	};

	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			const isMod = isMacPlatform() ? event.metaKey : event.ctrlKey;
			if (isMod && event.key.toLowerCase() === "k") {
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
			if (!typing && event.key === "?" && !isMod) {
				event.preventDefault();
				setShortcutsOpen(true);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const current = blocks[active.id] ?? [];
	const isPending = pending === active.id;
	const inputCollection = collectionInStatement(active.input);

	const side = (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-10 shrink-0 items-center border-border border-b px-1.5">
				<SegmentedTabs
					items={[
						{ id: "history" as const, label: "History", icon: History },
						{ id: "reference" as const, label: "Reference", icon: BookOpen },
					]}
					value={panel}
					onChange={setPanel}
					label="Side panel"
					className="flex-1"
				/>
			</div>
			{panel === "history" ? (
				<HistoryList
					entries={history.map((entry) => ({
						id: entry.id,
						text: entry.text,
						at: entry.at,
						ok: entry.ok,
						meta: formatMs(entry.durationMs),
					}))}
					onOpen={(item) => {
						apiRef.current?.setDoc(item.text);
						setInput(item.text);
						setSideSheet(false);
						setTimeout(() => apiRef.current?.focus(), 0);
					}}
					onClear={() => {
						clearMongoHistory(databaseId);
						setHistory([]);
					}}
					emptyHint="Commands you run on this database show up here. They stay in this browser only."
				/>
			) : (
				<MongoReference
					collection={inputCollection ?? collections.find((c) => !c.startsWith("_")) ?? null}
					onPick={insertText}
				/>
			)}
		</div>
	);

	/* ---------------- assistant ---------------- */

	const [assistantOpen, setAssistantOpen] = useState(false);
	const [assistantTrigger, setAssistantTrigger] = useState<AssistantTrigger | null>(null);
	useEffect(() => {
		if (!assistantOpen) setAssistantTrigger(null);
	}, [assistantOpen]);
	const askAi = useCallback((mode: AssistantTrigger["mode"], text?: string, error?: string) => {
		setAssistantOpen(true);
		setAssistantTrigger({ mode, sql: text, error, nonce: Date.now() });
	}, []);
	const inputText = () => apiRef.current?.getDoc() ?? "";

	const assistant = (
		<AssistantPanel
			variant="mongo"
			databaseId={databaseId}
			enabled={aiEnabled}
			trigger={assistantTrigger}
			getEditorSql={inputText}
			getStatementSql={inputText}
			onInsert={(text) => {
				apiRef.current?.setDoc(text);
				if (!desktop) setAssistantOpen(false);
				setTimeout(() => apiRef.current?.focus(), 0);
			}}
			onReplace={(text) => {
				apiRef.current?.setDoc(text);
				if (!desktop) setAssistantOpen(false);
				setTimeout(() => apiRef.current?.focus(), 0);
			}}
			onOpenTab={(text) => {
				if (!desktop) setAssistantOpen(false);
				openTab(text, "From AI");
			}}
			onClose={() => setAssistantOpen(false)}
			className="h-full"
		/>
	);

	const paletteActions: PaletteAction[] = [
		{ id: "run", label: "Run command", icon: Play, shortcut: "Enter", run: () => run() },
		{ id: "clear", label: "Clear output", icon: Eraser, shortcut: `${mod}L`, run: clearOutput },
		{ id: "new", label: "New session tab", icon: FilePlus2, run: () => openTab("") },
		{ id: "close", label: "Close this tab", icon: X, run: () => closeTab(active.id) },
		{
			id: "history",
			label: "Show command history",
			icon: History,
			run: () => showPanel("history"),
		},
		{
			id: "reference",
			label: "Browse methods and operators",
			icon: BookOpen,
			keywords: ["reference", "docs", "help", "operators"],
			run: () => showPanel("reference"),
		},
		{
			id: "browser",
			label: "Open the collection Browser",
			icon: FolderTree,
			keywords: ["collections", "documents"],
			run: () => router.push(`/databases/${databaseId}/browser`),
		},
		{
			id: "ask-write",
			label: "Ask AI to write a command",
			icon: Sparkles,
			keywords: ["ai", "assistant", "generate"],
			run: () => askAi("generate"),
		},
		{
			id: "ask-explain",
			label: "Ask AI to explain the input",
			icon: Sparkles,
			keywords: ["ai", "assistant"],
			run: () => {
				const text = inputText();
				if (text.trim()) askAi("explain", text);
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

	return (
		<div className="flex flex-col lg:h-[calc(100dvh-3.5rem)]">
			<div className="flex min-h-0 flex-1">
				{desktop && sideOpen && (
					<aside
						aria-label="History and reference"
						className="w-[272px] shrink-0 border-border border-r bg-sidebar"
					>
						{side}
					</aside>
				)}

				<div className="flex min-w-0 flex-1 flex-col max-lg:min-h-[calc(100dvh-3.5rem)]">
					<div className="sticky top-14 z-20 lg:static">
						<TabStrip
							tabs={tabs.map((tab) => ({
								id: tab.id,
								title: tab.title,
								pending: pending === tab.id,
							}))}
							activeId={active.id}
							onSelect={setActiveId}
							onClose={closeTab}
							onNew={() => openTab("")}
							label="Sessions"
							newLabel="New session tab"
							leading={
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={() => (desktop ? setSideOpen((v) => !v) : setSideSheet(true))}
									aria-label={desktop && sideOpen ? "Hide side panel" : "Show side panel"}
									title={desktop && sideOpen ? "Hide side panel" : "Show side panel"}
								>
									{desktop && sideOpen ? <PanelLeftClose /> : <PanelLeft />}
								</Button>
							}
						/>
						<div className="@container flex h-11 shrink-0 items-center gap-1 overflow-hidden border-border border-b bg-card px-2">
							<Button
								size="sm"
								onClick={() => run()}
								disabled={!!pending || suspended}
								title="Run (Enter)"
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
							<Button
								variant="ghost"
								size="sm"
								onClick={clearOutput}
								disabled={current.length === 0}
								title={`Clear output (${mod}L)`}
								aria-label="Clear output"
							>
								<Eraser data-icon="inline-start" />
								<span className="hidden @lg:inline">Clear</span>
							</Button>
							<Button variant="ghost" size="sm" asChild title="Browse collections">
								<Link
									href={`/databases/${databaseId}/browser`}
									aria-label="Open the collection Browser"
								>
									<FolderTree data-icon="inline-start" />
									<span className="hidden @lg:inline">Browser</span>
								</Link>
							</Button>
							<p className="ml-auto hidden truncate text-[0.6875rem] text-muted-foreground @4xl:block">
								Runs as <span className="font-mono text-foreground/80">{user}</span> ·{" "}
								{timeoutSeconds}s timeout · first {maxDocs} documents shown
							</p>
							<Button
								variant={assistantOpen ? "secondary" : "ghost"}
								size="sm"
								className="ml-auto @4xl:ml-0"
								onClick={() => setAssistantOpen((open) => !open)}
								aria-pressed={assistantOpen}
								aria-label="Ask AI"
								title={aiEnabled ? "Ask AI" : "Ask AI (not configured on this server)"}
							>
								<Sparkles
									data-icon="inline-start"
									className={aiEnabled ? "text-brand-text" : undefined}
								/>
								<span className="hidden @xl:inline">Ask AI</span>
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

					<div
						ref={transcriptRef}
						role="log"
						aria-label="Command output"
						aria-live="polite"
						aria-busy={isPending}
						className="min-h-[320px] flex-1 overflow-y-auto overscroll-contain bg-card"
					>
						{suspended && (
							<div className="m-4 rounded-lg border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm">
								<p className="font-medium text-warning">This database is suspended</p>
								<p className="mt-1 text-muted-foreground text-xs">
									Commands are refused until it is back under its storage limit.
								</p>
							</div>
						)}
						{current.length === 0 ? (
							<Welcome
								databaseName={databaseName}
								user={user}
								examples={examples(collections)}
								onExample={(text) => {
									apiRef.current?.setDoc(text);
									setInput(text);
									apiRef.current?.focus();
								}}
								modKey={modKey}
							/>
						) : (
							<ol className="divide-y divide-border/70">
								{current.map((block) => (
									<TranscriptBlock
										key={block.id}
										block={block}
										databaseId={databaseId}
										onRerun={() => run(block.source)}
										onFix={aiEnabled ? (text, error) => askAi("fix", text, error) : undefined}
										onEdit={() => {
											apiRef.current?.setDoc(block.source);
											setInput(block.source);
											apiRef.current?.focus();
										}}
									/>
								))}
							</ol>
						)}
					</div>

					<div className="sticky bottom-0 z-10 shrink-0 border-border border-t bg-[var(--code-background)] lg:static">
						<div className="flex items-start gap-1.5 pl-3">
							<ChevronRight
								className="mt-[11px] size-4 shrink-0 text-brand-text"
								aria-hidden="true"
								strokeWidth={2.25}
							/>
							<CodeEditor
								key={active.id}
								value={active.input}
								onChange={(value) => {
									setInput(value);
									historyCursor.current.index = -1;
								}}
								mode="shell"
								onSubmit={() => run()}
								submitOnEnter
								completion={completion}
								apiRef={apiRef}
								onKeys={keys}
								ariaLabel={`Mongo shell input, ${active.title}`}
								placeholder="db.collection.find({ … })"
								maxHeight="40vh"
								readOnly={suspended}
								className="flex-1 [&_.cm-editor]:bg-transparent"
							/>
							<Button
								variant="ghost"
								size="icon-sm"
								className="mt-1.5 mr-1.5 shrink-0"
								onClick={() => run()}
								disabled={!!pending || suspended}
								aria-label="Run"
								title="Run (Enter)"
							>
								{isPending ? (
									<Loader2 className="animate-spin motion-reduce:animate-none" />
								) : (
									<Play />
								)}
							</Button>
						</div>
						<div className="flex min-h-7 items-center gap-2 border-border/70 border-t px-3 py-1 text-[0.6875rem] text-muted-foreground">
							<span className="truncate">
								<Kbd>Enter</Kbd> runs · <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> new line · <Kbd>Tab</Kbd>{" "}
								completes · <Kbd>↑</Kbd> history
							</span>
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
							<SheetTitle>Ask AI</SheetTitle>
							<SheetDescription>
								Write, explain or fix Mongo shell commands with AI
							</SheetDescription>
						</SheetHeader>
						{assistant}
					</SheetContent>
				</Sheet>
			)}

			{!desktop && (
				<Sheet open={sideSheet} onOpenChange={setSideSheet}>
					<SheetContent side="left" className="w-[88vw] max-w-sm gap-0 p-0" showCloseButton={false}>
						<SheetHeader className="sr-only">
							<SheetTitle>History and reference</SheetTitle>
							<SheetDescription>Recent commands and what the shell understands</SheetDescription>
						</SheetHeader>
						{side}
					</SheetContent>
				</Sheet>
			)}

			<ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
			<CommandPalette
				open={paletteOpen}
				onOpenChange={setPaletteOpen}
				actions={paletteActions}
				title="Mongo shell commands"
				description="Shell actions, recent runs and collections"
				placeholder="Type an action, a recent command or a collection…"
				groups={[
					{
						heading: "Recent runs",
						items: history.slice(0, 8).map((entry) => ({
							id: entry.id,
							value: `recent ${entry.text.slice(0, 200)} ${entry.id}`,
							icon: History,
							label: (
								<span className="truncate font-mono text-xs">
									{entry.text.replace(/\s+/g, " ").slice(0, 90)}
								</span>
							),
							onSelect: () => {
								apiRef.current?.setDoc(entry.text);
								setInput(entry.text);
								apiRef.current?.focus();
							},
						})),
					},
					{
						heading: "Find in a collection",
						items: collections.map((name) => ({
							id: `coll-${name}`,
							value: `collection ${name}`,
							icon: Terminal,
							label: <span className="font-mono text-[0.8125rem]">{name}</span>,
							onSelect: () =>
								insertText(
									`${/^[A-Za-z_$][\w$]*$/.test(name) ? `db.${name}` : `db.getCollection(${JSON.stringify(name)})`}.find({  })`,
								),
						})),
					},
				]}
			/>
			<ShortcutsDialog
				open={shortcutsOpen}
				onOpenChange={setShortcutsOpen}
				description="Input shortcuts work while the shell input has focus."
				groups={[
					{
						title: "Run",
						items: [
							{ keys: ["Enter"], label: "Run the command" },
							{ keys: ["Shift", "Enter"], label: "Add a line" },
							{ keys: [modKey, "L"], label: "Clear the output" },
						],
					},
					{
						title: "Input",
						items: [
							{ keys: ["Tab"], label: "Accept a completion" },
							{ keys: ["Ctrl", "Space"], label: "Show completions" },
							{ keys: ["↑", "↓"], label: "Previous and next command from history" },
						],
					},
					{
						title: "Shell",
						items: [
							{ keys: [modKey, "K"], label: "Command palette" },
							{ keys: ["?"], label: "This list" },
						],
					},
				]}
			/>
		</div>
	);
}

/* ------------------------------------------------------------------ *
 * Transcript
 * ------------------------------------------------------------------ */

function Welcome({
	databaseName,
	user,
	examples,
	onExample,
	modKey,
}: {
	databaseName: string;
	user: string;
	examples: string[];
	onExample: (text: string) => void;
	modKey: string;
}) {
	return (
		<div className="mx-auto flex max-w-xl flex-col px-6 py-12 lg:py-16">
			<p className="flex items-center gap-2 font-medium text-[0.9375rem]">
				<Terminal className="size-4 text-muted-foreground" strokeWidth={1.75} />
				{databaseName}
			</p>
			<p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
				mongosh syntax, run as <span className="font-mono text-foreground/85">{user}</span> on a
				fresh TLS connection each time. Commands are parsed, never evaluated: no variables or loops,
				one command per run.
			</p>
			<p className="mt-6 mb-2 text-muted-foreground text-xs">Try one</p>
			<ul className="grid gap-1.5">
				{examples.map((example) => (
					<li key={example}>
						<button
							type="button"
							onClick={() => onExample(example)}
							className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-left font-mono text-[0.8125rem] transition-colors hover:border-border-strong hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
						>
							{example}
						</button>
					</li>
				))}
			</ul>
			<p className="mt-6 text-muted-foreground text-xs">
				<Kbd>{modKey}</Kbd> <Kbd>K</Kbd> for every action, <Kbd>?</Kbd> for shortcuts.
			</p>
		</div>
	);
}

function resultText(result: ShellResult): string {
	switch (result.kind) {
		case "documents":
			return result.docs.map((d) => toShell(d)).join("\n");
		case "value":
			return toShell(result.value);
		case "count":
			return String(result.value);
		case "text":
			return result.text;
	}
}

function TranscriptBlock({
	block,
	databaseId,
	onRerun,
	onEdit,
	onFix,
}: {
	block: Block;
	databaseId: string;
	onRerun: () => void;
	onEdit: () => void;
	onFix?: (source: string, error: string) => void;
}) {
	const outcome = block.outcome;
	const collection = collectionInStatement(block.source);
	return (
		<li className="group/block px-3 py-2.5 sm:px-4">
			<div className="flex items-start gap-2">
				<ChevronRight
					className="mt-[3px] size-3.5 shrink-0 text-muted-foreground/70"
					aria-hidden="true"
				/>
				<code
					className="min-w-0 whitespace-pre-wrap break-all font-mono text-[0.8125rem] text-foreground"
					translate="no"
				>
					{block.source}
				</code>
				<div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
					{outcome && (
						<span className="mr-1 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
							{formatMs(outcome.durationMs)}
						</span>
					)}
					<div className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/block:opacity-100 pointer-coarse:opacity-100">
						{outcome?.result && (
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label="Copy output"
								title="Copy output in shell syntax"
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(resultText(outcome.result as ShellResult));
										toast.success("Copied output");
									} catch {
										toast.error("Clipboard is not available");
									}
								}}
							>
								<ClipboardCopy />
							</Button>
						)}
						{collection && (
							<Button variant="ghost" size="icon-xs" asChild>
								<Link
									href={`/databases/${databaseId}/browser?c=${encodeURIComponent(collection)}`}
									aria-label={`Open ${collection} in the Browser`}
									title={`Open ${collection} in the Browser`}
								>
									<FolderTree />
								</Link>
							</Button>
						)}
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="Edit this command"
							title="Put it back in the input"
							onClick={onEdit}
						>
							<CommandIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="Run again"
							title="Run again"
							onClick={onRerun}
						>
							<RotateCcw />
						</Button>
					</div>
				</div>
			</div>
			<div className="mt-1.5 pl-[22px]">
				{block.pending ? (
					<p className="flex items-center gap-2 text-muted-foreground text-xs">
						<Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
						Running…
					</p>
				) : outcome ? (
					<OutcomeView
						outcome={outcome}
						onFix={
							onFix && !outcome.ok && (outcome.kind === "syntax" || outcome.kind === "server")
								? () => onFix(block.source, outcome.error ?? "")
								: undefined
						}
					/>
				) : null}
			</div>
		</li>
	);
}

function OutcomeView({ outcome, onFix }: { outcome: ShellOutcome; onFix?: () => void }) {
	return (
		<div className="space-y-1.5">
			{outcome.note && (
				<p className="flex items-start gap-1.5 text-muted-foreground text-xs">
					<Info className="mt-px size-3.5 shrink-0" />
					{outcome.note}
				</p>
			)}
			{outcome.result ? (
				<ResultView result={outcome.result} label={outcome.label} />
			) : outcome.kind === "blocked" ? (
				<Callout icon={Ban} tone="warning" title="Not available in the shell">
					{outcome.error}
				</Callout>
			) : outcome.kind === "confirm" ? (
				<p className="text-muted-foreground text-xs">{outcome.error}</p>
			) : (
				<Callout
					icon={CircleAlert}
					tone="danger"
					title={outcome.kind === "syntax" ? "Could not read this command" : "Command failed"}
				>
					<span className="font-mono">
						{outcome.error}
						{outcome.kind === "syntax" && outcome.position !== undefined && (
							<SyntaxPointer source={outcome.source} position={outcome.position} />
						)}
					</span>
				</Callout>
			)}
			{outcome.friendly && (
				<Callout icon={TriangleAlert} tone="warning">
					{outcome.friendly}
				</Callout>
			)}
			{onFix && (
				<Button variant="outline" size="xs" onClick={onFix}>
					<Sparkles data-icon="inline-start" />
					Fix with AI
				</Button>
			)}
		</div>
	);
}

/** The offending line with a caret under the column the parser stopped at. */
function SyntaxPointer({ source, position }: { source: string; position: number }) {
	const lineStart = source.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
	const lineEnd = source.indexOf("\n", position);
	const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
	const column = position - lineStart;
	if (line.length > 160) return null;
	return (
		<span className="mt-1.5 block whitespace-pre text-foreground/80" aria-hidden="true">
			{line}
			{"\n"}
			<span className="text-destructive">{`${" ".repeat(Math.max(0, column))}^`}</span>
		</span>
	);
}

/** Flat, narrow documents (an aggregation's counts) read best as a table. */
function prefersTable(docs: EJsonValue[]): boolean {
	if (docs.length < 2) return false;
	if (topLevelColumns(docs).length > 8) return false;
	return docs.every((doc) => isObject(doc) && Object.values(doc).every((v) => !isContainer(v)));
}

function ResultView({ result, label }: { result: ShellResult; label?: string }) {
	const [mode, setMode] = useState<"tree" | "table">(() => {
		const docs =
			result.kind === "documents"
				? result.docs
				: result.kind === "value" && Array.isArray(result.value)
					? result.value
					: [];
		return prefersTable(docs) ? "table" : "tree";
	});
	if (result.kind === "count") {
		return (
			<p className="font-mono text-[0.875rem] text-[var(--type-string)] tabular-nums">
				{result.value.toLocaleString()}
			</p>
		);
	}
	if (result.kind === "text") {
		return (
			<pre className="whitespace-pre-wrap break-all font-mono text-[0.8125rem] text-foreground/90">
				{result.text}
			</pre>
		);
	}
	if (result.kind === "value") {
		const v = result.value;
		if (
			Array.isArray(v) &&
			v.length > 0 &&
			v.every((item) => isObject(item) && isContainer(item))
		) {
			return (
				<DocumentsView
					docs={v}
					truncated={false}
					clipped={false}
					label={label}
					mode={mode}
					onMode={setMode}
				/>
			);
		}
		return isContainer(v) ? (
			<div className="max-w-4xl rounded-md border border-border bg-[var(--code-background)] py-1">
				<DocumentTree doc={v} openDepth={2} label="Result" />
			</div>
		) : (
			<p className="font-mono text-[0.8125rem]">
				<TypedValue value={v} />
			</p>
		);
	}
	return (
		<DocumentsView
			docs={result.docs}
			truncated={result.truncated}
			clipped={result.clipped}
			label={label}
			mode={mode}
			onMode={setMode}
		/>
	);
}

function DocumentsView({
	docs,
	truncated,
	clipped,
	label,
	mode,
	onMode,
}: {
	docs: EJsonValue[];
	truncated: boolean;
	clipped: boolean;
	label?: string;
	mode: "tree" | "table";
	onMode: (mode: "tree" | "table") => void;
}) {
	const [inspected, setInspected] = useState<number | null>(null);
	const [showAll, setShowAll] = useState(false);
	const columns = useMemo(() => topLevelColumns(docs), [docs]);
	const grid = useMemo(
		() => ({
			columns: columns.map((name) => {
				const types = new Set(
					docs
						.slice(0, 50)
						.map((d) => (isObject(d) ? d[name] : undefined))
						.filter((v) => v !== undefined)
						.map((v) => bsonTypeOf(v)),
				);
				return { name, type: types.size === 1 ? [...types][0] : "mixed" };
			}),
			rows: docs.map((doc) =>
				columns.map((name) => {
					const v = isObject(doc) ? doc[name] : undefined;
					if (v === undefined) return null;
					return typeof v === "number" || typeof v === "boolean" ? v : cellText(v);
				}),
			),
		}),
		[docs, columns],
	);

	if (docs.length === 0) {
		return <p className="text-muted-foreground text-xs">No documents.</p>;
	}
	const visible = showAll ? docs : docs.slice(0, 50);
	return (
		<div className="max-w-5xl space-y-1.5">
			<div className="flex items-center gap-2">
				<SegmentedTabs
					items={[
						{ id: "tree" as const, label: "Tree", icon: ListTree },
						{ id: "table" as const, label: "Table", icon: Table2 },
					]}
					value={mode}
					onChange={onMode}
					label="Show documents as"
					className="w-auto [&>button]:h-6 [&>button]:px-2"
				/>
				<span className="text-[0.6875rem] text-muted-foreground tabular-nums">
					{docs.length.toLocaleString()} {docs.length === 1 ? "document" : "documents"}
					{truncated ? " (capped)" : ""}
				</span>
			</div>
			{clipped && (
				<p className="text-warning text-xs">
					Large documents: the result was cut to stay under 4 MB. Use a projection.
				</p>
			)}
			{mode === "table" ? (
				<div
					className="flex max-h-[60vh] flex-col overflow-hidden rounded-md border border-border"
					style={{ height: Math.min(420, 40 + docs.length * 30) }}
				>
					<DataGrid
						columns={grid.columns}
						rows={grid.rows}
						onInspect={(i) => setInspected(i === inspected ? null : i)}
						inspectedRow={inspected}
						label={label ? `Result of ${label}` : "Result"}
						inspectLabel="Show document"
					/>
				</div>
			) : (
				<div className="space-y-1">
					{visible.map((doc, i) => (
						<div
							key={i}
							className="rounded-md border border-border bg-[var(--code-background)] py-0.5"
						>
							<DocumentTree doc={doc} openDepth={i < 3 ? 1 : 0} />
						</div>
					))}
					{docs.length > visible.length && (
						<Button variant="ghost" size="xs" onClick={() => setShowAll(true)}>
							<Braces data-icon="inline-start" />
							Show {(docs.length - visible.length).toLocaleString()} more
						</Button>
					)}
				</div>
			)}
			{mode === "table" && inspected !== null && docs[inspected] !== undefined && (
				<div className="rounded-md border border-border bg-[var(--code-background)] py-1">
					<DocumentTree doc={docs[inspected]} openDepth={2} />
				</div>
			)}
		</div>
	);
}

function Callout({
	icon: Icon,
	tone,
	title,
	children,
}: {
	icon: typeof Ban;
	tone: "warning" | "danger";
	title?: string;
	children: ReactNode;
}) {
	return (
		<div
			role={tone === "danger" ? "alert" : undefined}
			className={cn(
				"flex max-w-3xl items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed",
				tone === "danger"
					? "border-destructive/30 bg-destructive/[0.06]"
					: "border-warning/30 bg-warning/[0.06]",
			)}
		>
			<Icon
				className={cn(
					"mt-px size-3.5 shrink-0",
					tone === "danger" ? "text-destructive" : "text-warning",
				)}
			/>
			<div className="min-w-0">
				{title && (
					<p className={cn("font-medium", tone === "danger" ? "text-destructive" : "text-warning")}>
						{title}
					</p>
				)}
				<div className="break-words text-muted-foreground">{children}</div>
			</div>
		</div>
	);
}

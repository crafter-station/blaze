"use client";

import {
	Ban,
	BookOpen,
	ChevronRight,
	CircleAlert,
	ClipboardCopy,
	Command as CommandIcon,
	Eraser,
	FilePlus2,
	FolderTree,
	History,
	Keyboard,
	Loader2,
	PanelLeft,
	PanelLeftClose,
	Play,
	RotateCcw,
	Terminal,
	Timer,
	TriangleAlert,
	X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { runRedisAction } from "@/app/(dashboard)/databases/[id]/console/actions";
import { formatMs, isMacPlatform, useMediaQuery } from "@/components/console-shell/hooks";
import { HistoryList } from "@/components/console-shell/library";
import {
	CommandPalette,
	type PaletteAction,
	ShortcutsDialog,
} from "@/components/console-shell/palette";
import { SegmentedTabs, TabStrip } from "@/components/console-shell/tab-strip";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { classify } from "@/lib/redis/classify";
import { type CommandIndex, keyPositions, lookupCommand, renderSyntax } from "@/lib/redis/commands";
import { encodeKeyRef } from "@/lib/redis/keys";
import { formatReply } from "@/lib/redis/reply";
import { commandLines, tokenize } from "@/lib/redis/tokenize";
import type { CommandOutcome } from "@/lib/redis/types";
import { cn } from "@/lib/utils";
import { CommandInput, type InputApi, type InputHandlers } from "./command-input";
import {
	clearRedisHistory,
	pushRedisHistory,
	type RedisHistoryEntry,
	readRedisHistory,
} from "./history";
import { useCommandReference } from "./reference";
import { ReferencePanel } from "./reference-panel";
import { keyModeFor, ReplyView } from "./reply-view";

/**
 * The Redis console: a redis-cli session in the browser.
 *
 * Each tab is a session with its own input and transcript. A run sends every line of the
 * input in order on one connection, as the tenant's `default` user, and the transcript
 * gets one block per line. Replies render by RESP type; key names in them, and the key
 * arguments of each command, link to the key browser.
 */

export interface RedisConsoleProps {
	databaseId: string;
	databaseName: string;
	user: string;
	timeoutSeconds: number;
	blockingCapSeconds: number;
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
	line: string;
	at: number;
	pending: boolean;
	outcome?: CommandOutcome;
}

type SidePanel = "history" | "commands";

/** Transcripts outlive client-side navigation (Browser ↔ Console) for the session. */
const transcripts = new Map<string, Record<string, Block[]>>();

const storageKey = (databaseId: string) => `blaze.redis.tabs.${databaseId}`;
const newId = () => Math.random().toString(36).slice(2, 10);

const EXAMPLES = [
	"SCAN 0 MATCH user:* COUNT 20",
	"HGETALL user:1",
	"ZREVRANGE leaderboard:weekly 0 4 WITHSCORES",
	"INFO keyspace",
];

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

export function RedisConsole(props: RedisConsoleProps) {
	const { databaseId, databaseName, user, timeoutSeconds, blockingCapSeconds, suspended } = props;
	const desktop = useMediaQuery("(min-width: 1024px)");
	const mod = isMacPlatform() ? "⌘" : "Ctrl+";
	const modKey = mod.replace("+", "");
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const { reference, error: referenceError } = useCommandReference(databaseId);
	const index: CommandIndex | null = reference?.index ?? null;

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

	const apiRef = useRef<InputApi | null>(null);

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

	// "Open in console" from the Browser arrives as ?cmd=...: it lands in the input, not run.
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

	const [history, setHistory] = useState<RedisHistoryEntry[]>([]);
	useEffect(() => setHistory(readRedisHistory(databaseId)), [databaseId]);
	const historyCursor = useRef<{ index: number; draft: string }>({ index: -1, draft: "" });

	/* ---------------- running ---------------- */

	const [pending, setPending] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<{
		flagged: { line: string; reason: string }[];
		run: () => void;
	} | null>(null);
	const transcriptRef = useRef<HTMLDivElement>(null);

	const scrollToEnd = useCallback(() => {
		requestAnimationFrame(() => {
			const el = transcriptRef.current;
			if (el) el.scrollTop = el.scrollHeight;
		});
	}, []);

	const execute = useCallback(
		async (lines: string[], confirmed: boolean, fromInput: boolean) => {
			const tabId = activeIdRef.current;
			const runId = newId();
			const startedAt = Date.now();
			const fresh: Block[] = lines.map((line, i) => ({
				id: `${runId}-${i}`,
				line,
				at: startedAt,
				pending: true,
			}));
			setBlocks((map) => ({ ...map, [tabId]: [...(map[tabId] ?? []), ...fresh].slice(-300) }));
			setPending(tabId);
			if (fromInput) {
				setInput("");
				apiRef.current?.setDoc("");
			}
			historyCursor.current = { index: -1, draft: "" };
			scrollToEnd();

			let results: CommandOutcome[] = [];
			let failure: string | undefined;
			try {
				const outcome = await runRedisAction(databaseId, lines, confirmed);
				results = outcome.results;
				failure = outcome.error;
			} catch {
				failure = "Could not reach the server. Check your connection and try again.";
			}
			setPending(null);

			setBlocks((map) => ({
				...map,
				[tabId]: (map[tabId] ?? []).map((block) => {
					const at = fresh.findIndex((f) => f.id === block.id);
					if (at === -1) return block;
					const outcome: CommandOutcome = results[at] ?? {
						line: block.line,
						ok: false,
						kind: "connection",
						error: failure ?? "Not run.",
						durationMs: 0,
					};
					return { ...block, pending: false, outcome };
				}),
			}));
			setHistory(
				pushRedisHistory(databaseId, {
					id: runId,
					text: lines.join("\n"),
					at: startedAt,
					durationMs: Date.now() - startedAt,
					ok: !failure && results.every((r) => r.ok),
					commands: lines.length,
				}),
			);
			scrollToEnd();
		},
		[databaseId, setBlocks, setInput, scrollToEnd],
	);

	const run = useCallback(
		(text?: string) => {
			if (pending) return;
			const source = text ?? apiRef.current?.getDoc() ?? "";
			const lines = commandLines(source).map((l) => l.line);
			if (lines.length === 0) {
				apiRef.current?.focus();
				return;
			}
			const flagged = lines
				.map((line) => {
					const parsed = tokenize(line);
					if (parsed.error) return null;
					const verdict = classify(parsed.tokens.map((t) => t.text));
					return verdict.confirm ? { line, reason: verdict.confirm } : null;
				})
				.filter((x): x is { line: string; reason: string } => !!x);
			const fromInput = text === undefined;
			if (flagged.length) {
				setConfirm({ flagged, run: () => void execute(lines, true, fromInput) });
				return;
			}
			void execute(lines, false, fromInput);
		},
		[pending, execute],
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

	const pickCommand = useCallback((name: string) => {
		const doc = apiRef.current?.getDoc() ?? "";
		const text = `${name} `;
		if (!doc.trim()) apiRef.current?.setDoc(text);
		else apiRef.current?.setDoc(`${doc.replace(/\s*$/, "")}\n${text}`);
		setSideSheet(false);
		setTimeout(() => apiRef.current?.focus(), 0);
	}, []);

	const handlers = useRef<InputHandlers>({
		run: () => {},
		historyPrev: () => false,
		historyNext: () => false,
		clear: () => {},
		palette: () => {},
	});
	handlers.current = {
		run: () => run(),
		historyPrev: () => {
			if (history.length === 0) return false;
			const cursor = historyCursor.current;
			if (cursor.index === -1) cursor.draft = apiRef.current?.getDoc() ?? "";
			if (cursor.index >= history.length - 1) return true;
			cursor.index++;
			apiRef.current?.setDoc(history[cursor.index].text);
			return true;
		},
		historyNext: () => {
			const cursor = historyCursor.current;
			if (cursor.index === -1) return false;
			cursor.index--;
			apiRef.current?.setDoc(cursor.index === -1 ? cursor.draft : history[cursor.index].text);
			return true;
		},
		clear: clearOutput,
		palette: () => setPaletteOpen(true),
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

	const openKey = useCallback(
		(key: string) => {
			router.push(`/databases/${databaseId}/browser?key=${encodeURIComponent(key)}`);
		},
		[router, databaseId],
	);

	/* ---------------- signature line for the current input ---------------- */

	const signature = useMemo(() => {
		if (!index) return null;
		const lastLine =
			active.input
				.split("\n")
				.filter((l) => l.trim())
				.at(-1) ?? "";
		const words = tokenize(lastLine).tokens.map((t) => t.text);
		const found = lookupCommand(index, words);
		return found?.spec ?? null;
	}, [index, active.input]);

	const current = blocks[active.id] ?? [];
	const isPending = pending === active.id;

	const panels: { id: SidePanel; label: string; icon: typeof History }[] = [
		{ id: "history", label: "History", icon: History },
		{ id: "commands", label: "Commands", icon: BookOpen },
	];

	const side = (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-10 shrink-0 items-center border-border border-b px-1.5">
				<SegmentedTabs
					items={panels}
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
						meta: `${entry.commands > 1 ? `${entry.commands} cmds · ` : ""}${formatMs(entry.durationMs)}`,
					}))}
					onOpen={(item) => {
						apiRef.current?.setDoc(item.text);
						setInput(item.text);
						setSideSheet(false);
						setTimeout(() => apiRef.current?.focus(), 0);
					}}
					onClear={() => {
						clearRedisHistory(databaseId);
						setHistory([]);
					}}
					emptyHint="Commands you run on this database show up here. They stay in this browser only."
				/>
			) : (
				<ReferencePanel index={index} error={referenceError} onPick={pickCommand} />
			)}
		</div>
	);

	const paletteActions: PaletteAction[] = [
		{ id: "run", label: "Run commands", icon: Play, shortcut: "Enter", run: () => run() },
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
			id: "commands",
			label: "Browse commands",
			icon: BookOpen,
			keywords: ["reference", "docs", "help"],
			run: () => showPanel("commands"),
		},
		{
			id: "browser",
			label: "Open the key Browser",
			icon: FolderTree,
			keywords: ["keys", "tree"],
			run: () => router.push(`/databases/${databaseId}/browser`),
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
						aria-label="History and command reference"
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
								title="Run every line (Enter)"
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
							<Button variant="ghost" size="sm" asChild title="Browse keys">
								<Link href={`/databases/${databaseId}/browser`} aria-label="Open the key Browser">
									<FolderTree data-icon="inline-start" />
									<span className="hidden @lg:inline">Browser</span>
								</Link>
							</Button>
							<p className="ml-auto hidden truncate text-[0.6875rem] text-muted-foreground @4xl:block">
								Runs as <span className="font-mono text-foreground/80">{user}</span> ·{" "}
								{timeoutSeconds}s timeout · blocking commands capped at {blockingCapSeconds}s
							</p>
							<Button
								variant="ghost"
								size="sm"
								className="ml-auto text-muted-foreground @4xl:ml-0"
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
									Commands are refused until it is resumed. Free memory, or wait for the next check.
								</p>
							</div>
						)}
						{current.length === 0 ? (
							<Welcome
								databaseName={databaseName}
								user={user}
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
										index={index}
										onOpenKey={openKey}
										onRerun={() => run(block.line)}
										onEdit={() => {
											apiRef.current?.setDoc(block.line);
											setInput(block.line);
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
							<CommandInput
								key={active.id}
								value={active.input}
								onChange={(value) => {
									setInput(value);
									historyCursor.current.index = -1;
								}}
								index={index}
								handlers={handlers}
								apiRef={apiRef}
								label={`Redis command input, ${active.title}`}
								disabled={suspended}
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
							{signature ? (
								<>
									<span className="truncate font-mono text-foreground/80" translate="no">
										{renderSyntax(signature)}
									</span>
									{signature.summary && (
										<span className="hidden truncate xl:inline">{signature.summary}</span>
									)}
								</>
							) : (
								<span className="truncate">
									<Kbd>Enter</Kbd> runs every line · <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> new line ·{" "}
									<Kbd>Tab</Kbd> completes · <Kbd>↑</Kbd> history
								</span>
							)}
						</div>
					</div>
				</div>
			</div>

			{!desktop && (
				<Sheet open={sideSheet} onOpenChange={setSideSheet}>
					<SheetContent side="left" className="w-[88vw] max-w-sm gap-0 p-0" showCloseButton={false}>
						<SheetHeader className="sr-only">
							<SheetTitle>History and command reference</SheetTitle>
							<SheetDescription>
								Recent runs and every command this server documents
							</SheetDescription>
						</SheetHeader>
						{side}
					</SheetContent>
				</Sheet>
			)}

			<ConfirmCommands pending={confirm} onClose={() => setConfirm(null)} />
			<CommandPalette
				open={paletteOpen}
				onOpenChange={setPaletteOpen}
				actions={paletteActions}
				title="Redis console commands"
				description="Console actions, recent runs and the command reference"
				placeholder="Type an action, a recent command or a Redis command…"
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
						heading: "Insert a command",
						items: index
							? Object.values(index)
									.filter((spec) => !spec.name.includes(" ") && !spec.deprecated)
									.sort((a, b) => a.name.localeCompare(b.name))
									.map((spec) => ({
										id: `cmd-${spec.name}`,
										value: `command ${spec.name} ${spec.summary ?? ""}`,
										icon: Terminal,
										label: (
											<>
												<span className="font-mono text-[0.8125rem]">{spec.name}</span>
												{spec.summary && (
													<span className="ml-1 truncate text-muted-foreground text-xs">
														{spec.summary}
													</span>
												)}
											</>
										),
										onSelect: () => pickCommand(spec.name),
									}))
							: [],
					},
				]}
			/>
			<ShortcutsDialog
				open={shortcutsOpen}
				onOpenChange={setShortcutsOpen}
				description="Input shortcuts work while the command input has focus."
				groups={[
					{
						title: "Run",
						items: [
							{ keys: ["Enter"], label: "Run every line in the input" },
							{ keys: ["Shift", "Enter"], label: "Add a line" },
							{ keys: [modKey, "L"], label: "Clear the output" },
						],
					},
					{
						title: "Input",
						items: [
							{ keys: ["Tab"], label: "Accept a completion" },
							{ keys: ["Ctrl", "Space"], label: "Show completions" },
							{ keys: ["↑", "↓"], label: "Previous and next run from history" },
						],
					},
					{
						title: "Console",
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
	onExample,
	modKey,
}: {
	databaseName: string;
	user: string;
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
				Commands run as <span className="font-mono text-foreground/85">{user}</span>, one per line,
				on a fresh connection each run. Key names in replies open in the Browser.
			</p>
			<p className="mt-6 mb-2 text-muted-foreground text-xs">Try one</p>
			<ul className="grid gap-1.5">
				{EXAMPLES.map((example) => (
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

function TranscriptBlock({
	block,
	index,
	onOpenKey,
	onRerun,
	onEdit,
}: {
	block: Block;
	index: CommandIndex | null;
	onOpenKey: (key: string) => void;
	onRerun: () => void;
	onEdit: () => void;
}) {
	const outcome = block.outcome;
	const parsed = useMemo(() => tokenize(block.line), [block.line]);
	const words = parsed.tokens.map((t) => t.text);
	const command = words[0] ?? "";

	return (
		<li className="group/block px-3 py-2.5 sm:px-4">
			<div className="flex items-start gap-2">
				<ChevronRight
					className="mt-[3px] size-3.5 shrink-0 text-muted-foreground/70"
					aria-hidden="true"
				/>
				<CommandEcho line={block.line} parsed={parsed} index={index} onOpenKey={onOpenKey} />
				<div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
					{outcome && (
						<span className="mr-1 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
							{formatMs(outcome.durationMs)}
						</span>
					)}
					<div className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/block:opacity-100 pointer-coarse:opacity-100">
						{outcome?.reply && (
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label="Copy output"
								title="Copy output as redis-cli prints it"
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(
											formatReply(outcome.reply as NonNullable<typeof outcome.reply>),
										);
										toast.success("Copied output");
									} catch {
										toast.error("Clipboard is not available");
									}
								}}
							>
								<ClipboardCopy />
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
					<OutcomeView outcome={outcome} command={command} onOpenKey={onOpenKey} />
				) : null}
			</div>
		</li>
	);
}

function CommandEcho({
	line,
	parsed,
	index,
	onOpenKey,
}: {
	line: string;
	parsed: ReturnType<typeof tokenize>;
	index: CommandIndex | null;
	onOpenKey: (key: string) => void;
}) {
	if (parsed.error || !index) {
		return <code className="min-w-0 break-all font-mono text-[0.8125rem]">{line}</code>;
	}
	const words = parsed.tokens.map((t) => t.text);
	const keys = new Set(keyPositions(index, words));
	const pieces: ReactNode[] = [];
	let cursor = 0;
	parsed.tokens.forEach((token, i) => {
		if (token.from > cursor) pieces.push(line.slice(cursor, token.from));
		const source = line.slice(token.from, token.to);
		if (i === 0) {
			pieces.push(
				<span key={i} className="font-semibold">
					{source}
				</span>,
			);
		} else if (keys.has(i)) {
			pieces.push(
				<button
					key={i}
					type="button"
					onClick={() => onOpenKey(encodeKeyRef(token.bytes))}
					title={`Open ${token.text} in the Browser`}
					className="rounded-sm underline decoration-border-strong decoration-dotted underline-offset-4 hover:text-brand-text hover:decoration-brand focus-visible:outline-2 focus-visible:outline-ring"
				>
					{source}
				</button>,
			);
		} else {
			pieces.push(
				<span key={i} className={token.quoted ? "text-brand-text" : undefined}>
					{source}
				</span>,
			);
		}
		cursor = token.to;
	});
	if (cursor < line.length) pieces.push(line.slice(cursor));
	return (
		<code className="min-w-0 break-all font-mono text-[0.8125rem] text-foreground" translate="no">
			{pieces}
		</code>
	);
}

function OutcomeView({
	outcome,
	command,
	onOpenKey,
}: {
	outcome: CommandOutcome;
	command: string;
	onOpenKey: (key: string) => void;
}) {
	return (
		<div className="space-y-1.5">
			{outcome.note && (
				<p className="flex items-start gap-1.5 text-muted-foreground text-xs">
					<Timer className="mt-px size-3.5 shrink-0" />
					{outcome.note}
				</p>
			)}
			{outcome.reply ? (
				<ReplyView reply={outcome.reply} keyMode={keyModeFor(command)} onOpenKey={onOpenKey} />
			) : outcome.kind === "blocked" ? (
				<Callout icon={Ban} tone="warning" title="Not available in the console">
					{outcome.error}
				</Callout>
			) : outcome.kind === "skipped" || outcome.kind === "confirm" ? (
				<p className="text-muted-foreground text-xs">{outcome.error}</p>
			) : (
				<Callout
					icon={CircleAlert}
					tone="danger"
					title={outcome.kind === "syntax" ? "Could not read this line" : "Command failed"}
				>
					<span className="font-mono">{outcome.error}</span>
				</Callout>
			)}
			{outcome.friendly && (
				<Callout icon={TriangleAlert} tone={/full/.test(outcome.friendly) ? "danger" : "warning"}>
					{outcome.friendly}
				</Callout>
			)}
			{outcome.truncated && (
				<p className="text-muted-foreground text-xs">
					The reply was cut to keep the page responsive. Narrow the command (a COUNT, a range) to
					see the rest.
				</p>
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

/** Asks before FLUSHDB, FLUSHALL and multi-key DEL/UNLINK. Cancel is the default focus. */
function ConfirmCommands({
	pending,
	onClose,
}: {
	pending: { flagged: { line: string; reason: string }[]; run: () => void } | null;
	onClose: () => void;
}) {
	const count = pending?.flagged.length ?? 0;
	return (
		<AlertDialog open={!!pending} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent className="sm:max-w-lg">
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<TriangleAlert className="size-4 text-destructive" />
						{count === 1 ? "This command deletes data" : `${count} commands delete data`}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{count === 1 ? "It runs" : "They run"} as your database user and cannot be undone from
						here.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<ul className="max-h-[45dvh] space-y-2 overflow-y-auto">
					{pending?.flagged.map(({ line, reason }, i) => (
						<li key={i} className="overflow-hidden rounded-lg border border-destructive/25">
							<p className="border-destructive/20 border-b bg-destructive/[0.06] px-3 py-1.5 font-medium text-destructive text-xs">
								{reason}
							</p>
							<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words bg-[var(--code-background)] px-3 py-2 font-mono text-xs leading-relaxed">
								{line.length > 1200 ? `${line.slice(0, 1200)}…` : line}
							</pre>
						</li>
					))}
				</ul>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() => {
							pending?.run();
							onClose();
						}}
					>
						Run anyway
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

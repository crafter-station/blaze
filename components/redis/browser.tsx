"use client";

import {
	ClipboardCopy,
	Clock,
	Eraser,
	FolderTree,
	KeyRound,
	List,
	ListTree,
	Loader2,
	MoreHorizontal,
	Plus,
	RefreshCw,
	Search,
	SquareTerminal,
	Trash2,
	X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	deletePatternAction,
	flushDatabaseAction,
	healthAction,
	keyDetailsAction,
	memoryUsageAction,
	previewPatternAction,
	scanKeysAction,
} from "@/app/(dashboard)/databases/[id]/browser/actions";
import { useMediaQuery } from "@/components/console-shell/hooks";
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
import { FILTERABLE_TYPES, formatTtl, inspectCommand, keyLabel, typeLabel } from "@/lib/redis/keys";
import type { KeyEntry } from "@/lib/redis/tree";
import {
	type HealthSnapshot,
	hasJsonModule,
	type KeyDetails,
	type KeyValue,
	type ValuePage,
} from "@/lib/redis/types";
import { cn } from "@/lib/utils";
import { BulkDeleteDialog, FlushDialog } from "./edit-dialogs";
import { type EditEvent, useEditor, useKeyEditing } from "./editing";
import { HealthBar } from "./health-bar";
import { KeyTree, type TreeView } from "./key-tree";
import { NewKeyDialog } from "./new-key-dialog";
import { TypeBadge } from "./type-badge";
import { CollectionValue, copyText, MissingValue, RawValue, StringValue } from "./value-view";

/**
 * The key browser: the keyspace as a namespace tree (or a flat list), filtered by a SCAN
 * pattern and a type, paged by SCAN cursor; a type-aware view of the selected key; and
 * the database's health on top.
 *
 * The selected key lives in the URL (`?key=`), so the console can link here and a key
 * view can be shared or reloaded.
 */

export interface KeyBrowserProps {
	databaseId: string;
	databaseName: string;
	user: string;
	memoryLimit: number;
	suspended: boolean;
}

interface ScanState {
	entries: KeyEntry[];
	cursor: string;
	scanned: number;
	loading: boolean;
	error: string | null;
	/** True once a page has come back; the cursor then says whether there is more. */
	started: boolean;
}

const EMPTY_SCAN: ScanState = {
	entries: [],
	cursor: "0",
	scanned: 0,
	loading: false,
	error: null,
	started: false,
};

/** `user` searches `*user*`; anything with glob characters is used as typed. */
export function toPattern(filter: string): string {
	const text = filter.trim();
	if (!text) return "*";
	return /[*?[\]]/.test(text) ? text : `*${text.replace(/\\/g, "\\\\")}*`;
}

function prefixesOf(name: string, delimiter = ":"): string[] {
	const parts = name.split(delimiter);
	const out: string[] = [];
	let prefix = "";
	for (let i = 0; i < parts.length - 1; i++) {
		prefix += parts[i] + delimiter;
		out.push(prefix);
	}
	return out;
}

export function KeyBrowser({ databaseId, databaseName, suspended }: KeyBrowserProps) {
	const desktop = useMediaQuery("(min-width: 1024px)");
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const selected = searchParams.get("key");

	/* ---------------- health ---------------- */

	const [health, setHealth] = useState<HealthSnapshot | null>(null);
	const [healthLoading, setHealthLoading] = useState(false);
	const [healthError, setHealthError] = useState<string | null>(null);
	const loadHealth = useCallback(async () => {
		setHealthLoading(true);
		try {
			const result = await healthAction(databaseId);
			if (result.ok) {
				setHealth(result.health);
				setHealthError(null);
			} else setHealthError(result.error);
		} catch {
			setHealthError("Could not reach the server");
		} finally {
			setHealthLoading(false);
		}
	}, [databaseId]);
	useEffect(() => {
		void loadHealth();
	}, [loadHealth]);

	/* ---------------- keyspace ---------------- */

	const [filter, setFilter] = useState("");
	const [pattern, setPattern] = useState("*");
	const [type, setType] = useState<string>("all");
	const [view, setView] = useState<TreeView>("tree");
	const [scan, setScan] = useState<ScanState>(EMPTY_SCAN);
	const [memory, setMemory] = useState<Record<string, number | null>>({});
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const generation = useRef(0);

	useEffect(() => {
		try {
			const stored = localStorage.getItem("blaze.redis.view");
			if (stored === "flat" || stored === "tree") setView(stored);
		} catch {}
	}, []);
	const changeView = (next: TreeView) => {
		setView(next);
		try {
			localStorage.setItem("blaze.redis.view", next);
		} catch {}
	};

	const loadKeys = useCallback(
		async (reset: boolean) => {
			const gen = reset ? ++generation.current : generation.current;
			setScan((s) => ({
				...(reset ? EMPTY_SCAN : s),
				loading: true,
				error: null,
				started: reset ? false : s.started,
			}));
			try {
				const result = await scanKeysAction(databaseId, {
					cursor: reset ? "0" : scan.cursor,
					match: pattern,
					type: type === "all" ? undefined : type,
				});
				if (gen !== generation.current) return;
				if (!result.ok) {
					setScan((s) => ({ ...s, loading: false, error: result.friendly ?? result.error }));
					return;
				}
				setScan((s) => {
					const seen = new Set(reset ? [] : s.entries.map((e) => e.key));
					const added = result.keys.filter((k) => !seen.has(k.key));
					return {
						entries: reset ? result.keys : [...s.entries, ...added],
						cursor: result.cursor,
						scanned: (reset ? 0 : s.scanned) + result.scanned,
						loading: false,
						error: null,
						started: true,
					};
				});
			} catch {
				if (gen === generation.current) {
					setScan((s) => ({ ...s, loading: false, error: "Could not reach the server" }));
				}
			}
		},
		[databaseId, pattern, type, scan.cursor],
	);

	// A new pattern or type starts the walk over.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only the filter restarts the scan.
	useEffect(() => {
		void loadKeys(true);
	}, [pattern, type, databaseId]);

	// Debounced: typing a pattern should not fire a SCAN per keystroke.
	useEffect(() => {
		const timer = setTimeout(() => setPattern(toPattern(filter)), 300);
		return () => clearTimeout(timer);
	}, [filter]);

	const requested = useRef(new Set<string>());
	const loadMemory = useCallback(
		async (keys: string[]) => {
			const missing = keys.filter((k) => !requested.current.has(k)).slice(0, 100);
			if (missing.length === 0) return;
			for (const key of missing) requested.current.add(key);
			try {
				const result = await memoryUsageAction(databaseId, missing);
				if (!result.ok) return;
				setMemory((map) => {
					const next = { ...map };
					missing.forEach((key, i) => {
						next[key] = result.memory[i] ?? null;
					});
					return next;
				});
			} catch {
				for (const key of missing) requested.current.delete(key);
			}
		},
		[databaseId],
	);

	/* ---------------- selection ---------------- */

	const [details, setDetails] = useState<KeyDetails | null>(null);
	const [detailsLoading, setDetailsLoading] = useState(false);
	const [detailsError, setDetailsError] = useState<string | null>(null);
	const [keySheet, setKeySheet] = useState(false);
	const detailsFor = useRef<string | null>(null);

	const loadDetails = useCallback(
		async (key: string, page: ValuePage = {}, append = false) => {
			detailsFor.current = key;
			setDetailsLoading(true);
			setDetailsError(null);
			try {
				const result = await keyDetailsAction(databaseId, key, page);
				if (detailsFor.current !== key) return;
				if (!result.ok) {
					setDetailsError(result.friendly ?? result.error);
					return;
				}
				const fresh = result.details.meta;
				// Keep the list's type and TTL in step with what was just read.
				setScan((s) =>
					fresh.type === "none"
						? s
						: {
								...s,
								entries: s.entries.map((e) =>
									e.key === fresh.key ? { ...e, type: fresh.type, ttl: fresh.ttl } : e,
								),
							},
				);
				if (fresh.memory !== null) setMemory((m) => ({ ...m, [fresh.key]: fresh.memory }));
				setDetails((current) =>
					append && current && current.meta.key === key
						? { meta: result.details.meta, value: mergeValues(current.value, result.details.value) }
						: result.details,
				);
			} catch {
				if (detailsFor.current === key) setDetailsError("Could not reach the server");
			} finally {
				if (detailsFor.current === key) setDetailsLoading(false);
			}
		},
		[databaseId],
	);

	useEffect(() => {
		if (!selected) {
			setDetails(null);
			detailsFor.current = null;
			return;
		}
		void loadDetails(selected);
		// Reveal it in the tree.
		setExpanded((current) => {
			const prefixes = prefixesOf(keyLabel(selected));
			if (prefixes.every((p) => current.has(p))) return current;
			return new Set([...current, ...prefixes]);
		});
	}, [selected, loadDetails]);

	const select = useCallback(
		(key: string | null) => {
			const params = new URLSearchParams(searchParams.toString());
			if (key) params.set("key", key);
			else params.delete("key");
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
			if (key) setKeySheet(false);
		},
		[router, pathname, searchParams],
	);

	/* ---------------- changes ---------------- */

	const onEditEvent = useCallback(
		(event: EditEvent) => {
			void loadHealth();
			switch (event.kind) {
				case "updated":
					if (selected === event.key) void loadDetails(event.key);
					break;
				case "deleted":
					setScan((s) => ({ ...s, entries: s.entries.filter((e) => e.key !== event.key) }));
					select(null);
					break;
				case "renamed":
					setScan((s) => ({
						...s,
						entries: s.entries.map((e) =>
							e.key === event.from ? { ...e, key: event.to, name: keyLabel(event.to) } : e,
						),
					}));
					select(event.to);
					break;
				case "created":
					setScan((s) => ({
						...s,
						entries: s.entries.some((e) => e.key === event.key)
							? s.entries
							: [
									...s.entries,
									{ key: event.key, name: keyLabel(event.key), type: event.type, ttl: event.ttl },
								],
					}));
					select(event.key);
					break;
			}
		},
		[loadHealth, loadDetails, select, selected],
	);

	const editing = useKeyEditing({
		databaseId,
		details: details?.meta.key === selected ? details : null,
		onEvent: onEditEvent,
	});
	const createKey = useEditor(databaseId, onEditEvent);
	const [newKeyOpen, setNewKeyOpen] = useState(false);
	const [bulkOpen, setBulkOpen] = useState(false);
	const [flushOpen, setFlushOpen] = useState(false);

	/* ---------------- layout ---------------- */

	const done = scan.started && scan.cursor === "0";
	const total = health?.keys ?? null;

	const listPane = (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-col gap-2 border-border border-b p-2">
				<div className="flex items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						className="flex-1"
						onClick={() => setNewKeyOpen(true)}
						disabled={suspended}
					>
						<Plus data-icon="inline-start" />
						New key
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								size="icon-sm"
								aria-label="More key actions"
								disabled={suspended}
							>
								<MoreHorizontal />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-56">
							<DropdownMenuItem onSelect={() => setBulkOpen(true)}>
								<Trash2 className="text-muted-foreground" />
								Delete keys by pattern…
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onSelect={() => setFlushOpen(true)}>
								<Eraser />
								Flush database…
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				<label className="relative block">
					<span className="sr-only">Filter keys by name or glob pattern</span>
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						type="search"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") setPattern(toPattern(filter));
						}}
						placeholder="Filter: name, or a glob like user:*"
						spellCheck={false}
						autoComplete="off"
						className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 font-mono text-[0.75rem] outline-none transition-colors placeholder:font-sans placeholder:text-[0.8125rem] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
					/>
				</label>
				<div className="flex items-center gap-1.5">
					<Select value={type} onValueChange={setType}>
						<SelectTrigger size="sm" className="min-w-0 flex-1 text-xs" aria-label="Filter by type">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All types</SelectItem>
							{FILTERABLE_TYPES.map((t) => (
								<SelectItem key={t} value={t}>
									<TypeBadge type={t} className="w-10" />
									{typeLabel(t)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div
						role="radiogroup"
						aria-label="Key list layout"
						className="flex rounded-md border border-input p-0.5"
					>
						{(
							[
								["tree", ListTree, "Namespace tree"],
								["flat", List, "Flat list"],
							] as const
						).map(([id, Icon, label]) => (
							<button
								key={id}
								type="button"
								role="radio"
								aria-checked={view === id}
								aria-label={label}
								title={label}
								onClick={() => changeView(id)}
								className={cn(
									"flex size-6 items-center justify-center rounded-[5px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
									view === id
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<Icon className="size-3.5" />
							</button>
						))}
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => {
							requested.current.clear();
							setMemory({});
							void loadKeys(true);
							void loadHealth();
						}}
						aria-label="Reload keys"
						title="Reload keys"
					>
						<RefreshCw />
					</Button>
				</div>
			</div>

			{scan.error ? (
				<div className="p-4">
					<p
						role="alert"
						className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-destructive text-xs"
					>
						{scan.error}
					</p>
				</div>
			) : !scan.started && scan.loading ? (
				<ListSkeleton />
			) : scan.entries.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
					<KeyRound className="size-5 text-muted-foreground" strokeWidth={1.5} />
					<p className="mt-2 font-medium text-[0.8125rem]">
						{done
							? pattern === "*" && type === "all"
								? "No keys yet"
								: "No keys match"
							: "No matches so far"}
					</p>
					<p className="mt-1 max-w-56 text-muted-foreground text-xs leading-relaxed">
						{done
							? pattern === "*" && type === "all"
								? "Write some with your client or the console and they show up here."
								: `Nothing matches ${pattern}${type !== "all" ? ` of type ${typeLabel(type)}` : ""}.`
							: "SCAN walks the keyspace in slices. Keep going to look further."}
					</p>
					{!done && (
						<Button
							variant="outline"
							size="xs"
							className="mt-3"
							onClick={() => void loadKeys(false)}
							disabled={scan.loading}
						>
							{scan.loading && (
								<Loader2
									className="animate-spin motion-reduce:animate-none"
									data-icon="inline-start"
								/>
							)}
							Keep scanning
						</Button>
					)}
				</div>
			) : (
				<KeyTree
					entries={scan.entries}
					view={view}
					selected={selected}
					onSelect={(key) => select(key)}
					memory={memory}
					onVisibleKeys={(keys) => void loadMemory(keys)}
					expanded={expanded}
					onExpandedChange={setExpanded}
					footer={
						<footer className="flex h-9 shrink-0 items-center gap-2 border-border border-t px-3 text-[0.6875rem] text-muted-foreground">
							<span className="truncate tabular-nums">
								{done
									? `${scan.entries.length.toLocaleString()} ${scan.entries.length === 1 ? "key" : "keys"}${pattern !== "*" || type !== "all" ? " match" : ""}`
									: `${scan.entries.length.toLocaleString()} loaded${total !== null ? ` · ${total.toLocaleString()} in database` : ""}`}
							</span>
							{!done && (
								<Button
									variant="ghost"
									size="xs"
									className="ml-auto"
									onClick={() => void loadKeys(false)}
									disabled={scan.loading}
								>
									{scan.loading && (
										<Loader2
											className="animate-spin motion-reduce:animate-none"
											data-icon="inline-start"
										/>
									)}
									Load more
								</Button>
							)}
						</footer>
					}
				/>
			)}
		</div>
	);

	const keyPanel = selected ? (
		<KeyPanel
			databaseId={databaseId}
			selected={selected}
			details={details?.meta.key === selected ? details : null}
			loading={detailsLoading}
			error={detailsError}
			onClose={() => select(null)}
			onRefresh={() => void loadDetails(selected)}
			onPage={(page, append) => void loadDetails(selected, page, append)}
			actions={editing.actions}
			rowAction={editing.rowAction}
			valueToolbar={editing.valueToolbar}
		/>
	) : (
		<NothingSelected
			total={total}
			onBrowse={desktop ? undefined : () => setKeySheet(true)}
			databaseId={databaseId}
		/>
	);

	return (
		<div className="flex flex-col lg:h-[calc(100dvh-3.5rem)]">
			<HealthBar
				health={health}
				loading={healthLoading}
				error={healthError}
				onRefresh={() => void loadHealth()}
			/>
			{suspended && (
				<p className="border-warning/30 border-b bg-warning/[0.06] px-4 py-2 text-warning text-xs">
					This database is suspended: reads and writes are refused until memory is freed.
				</p>
			)}
			{desktop ? (
				<div className="flex min-h-0 flex-1">
					<aside
						aria-label={`Keys in ${databaseName}`}
						className="w-[360px] shrink-0 border-border border-r bg-sidebar xl:w-[400px]"
					>
						{listPane}
					</aside>
					<div className="flex min-w-0 flex-1 flex-col bg-card">{keyPanel}</div>
				</div>
			) : (
				<div className="flex min-h-[calc(100dvh-7rem)] flex-1 flex-col bg-card">
					<div className="sticky top-14 z-20 flex h-11 shrink-0 items-center gap-2 border-border border-b bg-background px-3">
						<Button variant="outline" size="sm" onClick={() => setKeySheet(true)}>
							<FolderTree data-icon="inline-start" />
							Keys
							{scan.started && (
								<span className="text-muted-foreground tabular-nums">
									{scan.entries.length.toLocaleString()}
									{done ? "" : "+"}
								</span>
							)}
						</Button>
						{selected && (
							<span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
								{keyLabel(selected)}
							</span>
						)}
					</div>
					{keyPanel}
					<Sheet open={keySheet} onOpenChange={setKeySheet}>
						<SheetContent
							side="left"
							className="w-[92vw] max-w-sm gap-0 p-0"
							showCloseButton={false}
						>
							<SheetHeader className="sr-only">
								<SheetTitle>Keys</SheetTitle>
								<SheetDescription>Browse and filter the keys in {databaseName}</SheetDescription>
							</SheetHeader>
							{listPane}
						</SheetContent>
					</Sheet>
				</div>
			)}

			{editing.dialogs}
			<NewKeyDialog
				open={newKeyOpen}
				jsonAvailable={health ? hasJsonModule(health.server) : true}
				initialPrefix={filter && !/[*?[]]/.test(filter) && filter.endsWith(":") ? filter : ""}
				onClose={() => setNewKeyOpen(false)}
				onCreate={({ key, ttl, value }) =>
					createKey({ op: "create", key, ttl, value }, (ref) => ({
						kind: "created",
						key: ref ?? key,
						type: value.type === "json" ? "ReJSON-RL" : value.type,
						ttl: ttl ? ttl * 1000 : -1,
					}))
				}
			/>
			<BulkDeleteDialog
				open={bulkOpen}
				initialPattern={pattern}
				onClose={() => setBulkOpen(false)}
				onPreview={async (p) => {
					try {
						const result = await previewPatternAction(databaseId, p);
						return result.ok ? result : (result.friendly ?? result.error);
					} catch {
						return "Could not reach the server";
					}
				}}
				onDelete={async (p) => {
					try {
						const result = await deletePatternAction(databaseId, p, p);
						if (!result.ok) return result.friendly ?? result.error;
						toast.success(
							`Deleted ${result.deleted.toLocaleString()} ${result.deleted === 1 ? "key" : "keys"}`,
						);
						select(null);
						void loadKeys(true);
						void loadHealth();
						return result;
					} catch {
						return "Could not reach the server";
					}
				}}
			/>
			<FlushDialog
				open={flushOpen}
				databaseName={databaseName}
				keys={total}
				onClose={() => setFlushOpen(false)}
				onFlush={async (typed) => {
					try {
						const result = await flushDatabaseAction(databaseId, typed);
						if (!result.ok) return result.friendly ?? result.error;
						toast.success("Database flushed");
						select(null);
						void loadKeys(true);
						void loadHealth();
						return null;
					} catch {
						return "Could not reach the server";
					}
				}}
			/>
		</div>
	);
}

/** Load more of a hash or set: append the next SCAN page to what is shown. */
function mergeValues(current: KeyValue, next: KeyValue): KeyValue {
	if (current.kind === "hash" && next.kind === "hash") {
		const seen = new Set(current.entries.map((e) => e.field.ref || e.field.text));
		return {
			...next,
			entries: [
				...current.entries,
				...next.entries.filter((e) => !seen.has(e.field.ref || e.field.text)),
			],
		};
	}
	if (current.kind === "set" && next.kind === "set") {
		const seen = new Set(current.members.map((m) => m.ref || m.text));
		return {
			...next,
			members: [...current.members, ...next.members.filter((m) => !seen.has(m.ref || m.text))],
		};
	}
	return next;
}

/* ------------------------------------------------------------------ *
 * The selected key
 * ------------------------------------------------------------------ */

function KeyPanel({
	databaseId,
	selected,
	details,
	loading,
	error,
	onClose,
	onRefresh,
	onPage,
	actions,
	rowAction,
	valueToolbar,
}: {
	databaseId: string;
	selected: string;
	details: KeyDetails | null;
	loading: boolean;
	error: string | null;
	onClose: () => void;
	onRefresh: () => void;
	onPage: (page: ValuePage, append: boolean) => void;
	actions?: ReactNode;
	rowAction?: Parameters<typeof CollectionValue>[0]["rowAction"];
	valueToolbar?: ReactNode;
}) {
	const meta = details?.meta;
	const name = keyLabel(selected);
	const consoleCommand = inspectCommand(meta?.type ?? "string", selected);

	return (
		<section aria-label={`Key ${name}`} className="flex min-h-0 flex-1 flex-col">
			<header className="shrink-0 border-border border-b px-4 py-3">
				<div className="flex items-start gap-2">
					{meta && meta.type !== "none" && <TypeBadge type={meta.type} className="mt-[3px]" />}
					<h2
						className="min-w-0 flex-1 break-all font-medium font-mono text-[0.875rem] leading-snug"
						translate="no"
					>
						{name}
					</h2>
					<div className="-mt-1 -mr-1 flex shrink-0 items-center gap-0.5">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => void copyText(name, "key name")}
							aria-label="Copy key name"
							title="Copy key name"
						>
							<ClipboardCopy />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onRefresh}
							disabled={loading}
							aria-label="Reload key"
							title="Reload"
						>
							{loading ? (
								<Loader2 className="animate-spin motion-reduce:animate-none" />
							) : (
								<RefreshCw />
							)}
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onClose}
							aria-label="Close key"
							title="Close"
						>
							<X />
						</Button>
					</div>
				</div>
				<div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
					{meta && meta.type !== "none" ? (
						<dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
							<Meta label="Type">{typeLabel(meta.type)}</Meta>
							<Meta label="TTL">
								<span
									className={cn(
										"inline-flex items-center gap-1",
										meta.ttl >= 0 && "text-foreground",
									)}
								>
									{meta.ttl >= 0 && <Clock className="size-3" />}
									{formatTtl(meta.ttl)}
								</span>
							</Meta>
							{meta.memory !== null && <Meta label="Memory">{formatBytes(meta.memory)}</Meta>}
							{meta.length !== null && (
								<Meta
									label={
										meta.type === "string"
											? "Length"
											: meta.type === "ReJSON-RL"
												? "Size"
												: "Elements"
									}
								>
									{meta.type === "string" || meta.type === "ReJSON-RL"
										? formatBytes(meta.length)
										: meta.length.toLocaleString()}
								</Meta>
							)}
							{meta.encoding && <Meta label="Encoding">{meta.encoding}</Meta>}
						</dl>
					) : (
						!error && (
							<span className="h-3 w-64 animate-pulse rounded bg-foreground/[0.07] motion-reduce:animate-none" />
						)
					)}
					<div className="ml-auto flex flex-wrap items-center gap-1">
						{actions}
						<Button variant="outline" size="xs" asChild>
							<Link
								href={`/databases/${databaseId}/console?cmd=${encodeURIComponent(consoleCommand)}`}
								title={consoleCommand}
							>
								<SquareTerminal data-icon="inline-start" />
								Open in console
							</Link>
						</Button>
					</div>
				</div>
			</header>

			{error ? (
				<div className="p-4">
					<p
						role="alert"
						className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-destructive text-xs"
					>
						{error}
					</p>
				</div>
			) : !details ? (
				<ValueSkeleton />
			) : (
				<ValueBody
					details={details}
					databaseId={databaseId}
					loading={loading}
					onPage={onPage}
					rowAction={rowAction}
					toolbar={valueToolbar}
				/>
			)}
		</section>
	);
}

function ValueBody({
	details,
	databaseId,
	loading,
	onPage,
	rowAction,
	toolbar,
}: {
	details: KeyDetails;
	databaseId: string;
	loading: boolean;
	onPage: (page: ValuePage, append: boolean) => void;
	rowAction?: Parameters<typeof CollectionValue>[0]["rowAction"];
	toolbar?: ReactNode;
}) {
	const { value, meta } = details;
	switch (value.kind) {
		case "missing":
			return <MissingValue />;
		case "string":
			return <StringValue key={meta.key} value={value.value} toolbar={toolbar} />;
		case "list":
		case "hash":
		case "set":
		case "zset":
			return (
				<CollectionValue
					value={value}
					label={`${typeLabel(meta.type)} ${meta.name}`}
					loading={loading}
					onPage={onPage}
					rowAction={rowAction}
					toolbar={toolbar}
				/>
			);
		case "other":
			return <RawValue type={value.type} command={value.command} databaseId={databaseId} />;
		default:
			return (
				<RawValue
					type={meta.type}
					command={inspectCommand(meta.type, meta.key)}
					databaseId={databaseId}
				/>
			);
	}
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-center gap-1.5">
			<dt>{label}</dt>
			<dd className="font-mono text-foreground/90 tabular-nums">{children}</dd>
		</div>
	);
}

function NothingSelected({
	total,
	onBrowse,
	databaseId,
}: {
	total: number | null;
	onBrowse?: () => void;
	databaseId: string;
}) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
			<div className="relative mb-5">
				<div className="absolute -inset-4 rounded-full bg-[radial-gradient(closest-side,var(--brand-soft),transparent)]" />
				<span className="relative flex size-11 items-center justify-center rounded-xl border border-border bg-background shadow-xs">
					<KeyRound className="size-5 text-muted-foreground" strokeWidth={1.5} />
				</span>
			</div>
			<p className="font-medium text-[0.9375rem]">Pick a key to see its value</p>
			<p className="mt-1.5 max-w-sm text-balance text-muted-foreground text-sm leading-relaxed">
				{total !== null ? `${total.toLocaleString()} keys in this database. ` : ""}
				Filter by name or glob pattern, or by type, and open one to inspect it.
			</p>
			<div className="mt-5 flex flex-wrap items-center justify-center gap-2">
				{onBrowse && (
					<Button size="sm" onClick={onBrowse}>
						<FolderTree data-icon="inline-start" />
						Browse keys
					</Button>
				)}
				<Button size="sm" variant="outline" asChild>
					<Link href={`/databases/${databaseId}/console`}>
						<SquareTerminal data-icon="inline-start" />
						Open console
					</Link>
				</Button>
			</div>
		</div>
	);
}

function ListSkeleton() {
	return (
		<div className="space-y-2.5 p-3" aria-hidden="true">
			{[72, 56, 64, 48, 60, 52, 68].map((width, i) => (
				<div key={i} className="flex items-center gap-2">
					<div className="h-[18px] w-11 animate-pulse rounded bg-foreground/[0.07] motion-reduce:animate-none" />
					<div
						className="h-3 animate-pulse rounded bg-foreground/[0.06] motion-reduce:animate-none"
						style={{ width: `${width}%` }}
					/>
				</div>
			))}
		</div>
	);
}

function ValueSkeleton() {
	return (
		<div className="space-y-2.5 p-4" aria-hidden="true">
			{[80, 64, 72, 40].map((width, i) => (
				<div
					key={i}
					className="h-3 animate-pulse rounded bg-foreground/[0.06] motion-reduce:animate-none"
					style={{ width: `${width}%` }}
				/>
			))}
		</div>
	);
}

export { KeyPanel };

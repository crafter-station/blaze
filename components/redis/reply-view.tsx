"use client";

import { Braces } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { Reply } from "@/lib/redis/reply";
import { cn } from "@/lib/utils";

/**
 * A reply rendered by its RESP type, in redis-cli's shape (numbered arrays, nested
 * indentation, `(integer)`, `(nil)`, `(error)`), but readable: types are labelled in a
 * muted tone, strings wrap, JSON strings can be pretty-printed in place, and key names
 * link to the key browser.
 */

/** How a reply refers to keys, so the renderer knows which strings to make links. */
export type KeyMode =
	/** Every string element is a key name (KEYS, RANDOMKEY, the key list in SCAN). */
	| "all"
	/** `[cursor, [keys]]` from SCAN. */
	| "scan"
	| null;

/** Keys in replies of these commands are key names. */
export function keyModeFor(command: string): KeyMode {
	switch (command.toUpperCase()) {
		case "SCAN":
			return "scan";
		case "KEYS":
		case "RANDOMKEY":
			return "all";
		default:
			return null;
	}
}

const INITIAL_ITEMS = 200;

export function ReplyView({
	reply,
	keyMode = null,
	onOpenKey,
}: {
	reply: Reply;
	keyMode?: KeyMode;
	onOpenKey?: (key: string) => void;
}) {
	return (
		<div className="font-mono text-[0.8125rem] leading-[1.6]" translate="no">
			<Node
				reply={reply}
				keyish={keyMode === "all"}
				scan={keyMode === "scan"}
				onOpenKey={onOpenKey}
			/>
		</div>
	);
}

function Muted({ children }: { children: ReactNode }) {
	return <span className="select-none text-muted-foreground/80">{children}</span>;
}

function Node({
	reply,
	keyish,
	scan,
	onOpenKey,
}: {
	reply: Reply;
	keyish?: boolean;
	scan?: boolean;
	onOpenKey?: (key: string) => void;
}) {
	switch (reply.t) {
		case "simple":
			return <span className="text-foreground">{reply.v}</span>;
		case "error":
			return (
				<span className="text-destructive">
					<Muted>(error) </Muted>
					{reply.v}
				</span>
			);
		case "int":
			return (
				<span>
					<Muted>(integer) </Muted>
					<span className="tabular-nums">{reply.v}</span>
				</span>
			);
		case "double":
			return (
				<span>
					<Muted>(double) </Muted>
					<span className="tabular-nums">{reply.v}</span>
				</span>
			);
		case "big":
			return (
				<span>
					<Muted>(big number) </Muted>
					<span className="tabular-nums">{reply.v}</span>
				</span>
			);
		case "bool":
			return <Muted>({reply.v ? "true" : "false"})</Muted>;
		case "nil":
			return <Muted>(nil)</Muted>;
		case "verbatim":
			return <pre className="whitespace-pre-wrap break-words font-mono">{reply.v}</pre>;
		case "bulk":
			return <Bulk reply={reply} keyish={keyish} onOpenKey={onOpenKey} />;
		case "array":
		case "set":
		case "push":
			return <List reply={reply} scan={scan} keyish={keyish} onOpenKey={onOpenKey} />;
		case "map":
			return <MapNode reply={reply} onOpenKey={onOpenKey} />;
	}
}

function Bulk({
	reply,
	keyish,
	onOpenKey,
}: {
	reply: Extract<Reply, { t: "bulk" }>;
	keyish?: boolean;
	onOpenKey?: (key: string) => void;
}) {
	const [pretty, setPretty] = useState(false);
	const json = useMemo(() => {
		if (reply.binary || reply.truncated || reply.v.length < 2) return null;
		const trimmed = reply.v.trim();
		if (!/^[[{]/.test(trimmed)) return null;
		try {
			return JSON.stringify(JSON.parse(trimmed), null, 2);
		} catch {
			return null;
		}
	}, [reply]);

	if (keyish && onOpenKey && !reply.binary) {
		return (
			<button
				type="button"
				onClick={() => onOpenKey(reply.v)}
				title="Open in Browser"
				className="rounded-sm text-left text-foreground underline decoration-border-strong decoration-dotted underline-offset-4 hover:text-brand-text hover:decoration-brand focus-visible:outline-2 focus-visible:outline-ring"
			>
				"{reply.v}"
			</button>
		);
	}

	return (
		<span className="inline">
			{pretty && json ? (
				<pre className="my-0.5 overflow-x-auto rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-[0.75rem] leading-relaxed">
					{json}
				</pre>
			) : (
				<span className="whitespace-pre-wrap break-all text-foreground">
					<span className="text-muted-foreground/70">"</span>
					{reply.binary ? <span className="text-foreground/85">{reply.v}</span> : reply.v}
					<span className="text-muted-foreground/70">"</span>
				</span>
			)}
			{reply.binary && <Muted> binary, {reply.len} bytes</Muted>}
			{reply.truncated && <Muted> … first part of {reply.len.toLocaleString()} bytes</Muted>}
			{json && (
				<button
					type="button"
					onClick={() => setPretty((v) => !v)}
					aria-pressed={pretty}
					title={pretty ? "Show as stored" : "Format JSON"}
					className="ml-1.5 inline-flex translate-y-[1px] items-center gap-1 rounded-sm px-1 align-middle font-sans text-[0.6875rem] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
				>
					<Braces className="size-3" />
					{pretty ? "Raw" : "JSON"}
				</button>
			)}
		</span>
	);
}

function List({
	reply,
	scan,
	keyish,
	onOpenKey,
}: {
	reply: Extract<Reply, { t: "array" | "set" | "push" }>;
	scan?: boolean;
	keyish?: boolean;
	onOpenKey?: (key: string) => void;
}) {
	const [all, setAll] = useState(false);
	if (reply.items.length === 0)
		return <Muted>{reply.t === "set" ? "(empty set)" : "(empty array)"}</Muted>;
	const shown = all ? reply.items : reply.items.slice(0, INITIAL_ITEMS);
	const marker = reply.t === "set" ? "~" : ")";
	const width = String(reply.items.length).length;
	return (
		<div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
			{shown.map((item, i) => (
				<Row key={i} label={`${String(i + 1).padStart(width, " ")}${marker}`}>
					<Node
						reply={item}
						// In a SCAN reply the second element is the page of keys.
						keyish={keyish || (scan && i === 1)}
						onOpenKey={onOpenKey}
					/>
				</Row>
			))}
			{(reply.items.length > shown.length || reply.truncated) && (
				<div className="col-span-2 py-0.5 font-sans text-muted-foreground text-xs">
					{reply.items.length > shown.length && (
						<button
							type="button"
							onClick={() => setAll(true)}
							className="mr-2 rounded-sm text-foreground underline underline-offset-4 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-ring"
						>
							Show all {reply.items.length.toLocaleString()}
						</button>
					)}
					{reply.truncated &&
						`${(reply.len - reply.items.length).toLocaleString()} more not shown. Narrow the command to see them.`}
				</div>
			)}
		</div>
	);
}

function MapNode({
	reply,
	onOpenKey,
}: {
	reply: Extract<Reply, { t: "map" }>;
	onOpenKey?: (key: string) => void;
}) {
	if (reply.entries.length === 0) return <Muted>(empty hash)</Muted>;
	const width = String(reply.entries.length).length;
	return (
		<div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
			{reply.entries.map(([k, v], i) => (
				<Row key={i} label={`${String(i + 1).padStart(width, " ")}#`}>
					<span className="inline">
						<Node reply={k} onOpenKey={onOpenKey} />
						<Muted> =&gt; </Muted>
						{v.t === "array" || v.t === "map" || v.t === "set" ? (
							<div className="pl-4">
								<Node reply={v} onOpenKey={onOpenKey} />
							</div>
						) : (
							<Node reply={v} onOpenKey={onOpenKey} />
						)}
					</span>
				</Row>
			))}
			{reply.truncated && (
				<div className="col-span-2 py-0.5 font-sans text-muted-foreground text-xs">
					{(reply.len - reply.entries.length).toLocaleString()} more not shown.
				</div>
			)}
		</div>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<span
				className={cn(
					"select-none whitespace-pre text-right text-muted-foreground/70 tabular-nums",
				)}
			>
				{label}
			</span>
			<div className="min-w-0">{children}</div>
		</>
	);
}

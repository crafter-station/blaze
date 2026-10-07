"use client";

import {
	ArrowUp,
	ClipboardCopy,
	FilePlus2,
	Loader2,
	Replace,
	Sparkles,
	Square,
	TextCursorInput,
	X,
} from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isMacPlatform } from "./hooks";

/**
 * "Ask Claude": write SQL from a description, explain the statement under the cursor, or
 * fix the one that just failed. Answers stream in; any SQL in them can be inserted,
 * swapped in, or opened in a new tab, and is never run from here.
 */

export type AssistantMode = "generate" | "explain" | "fix";

export interface AssistantTrigger {
	mode: AssistantMode;
	sql?: string;
	error?: string;
	/** Changes on every trigger so the same request can be sent twice. */
	nonce: number;
}

type Status = "idle" | "streaming" | "done" | "error";

export function AssistantPanel({
	databaseId,
	enabled,
	trigger,
	getEditorSql,
	getStatementSql,
	onInsert,
	onReplace,
	onOpenTab,
	onClose,
	className,
}: {
	databaseId: string;
	enabled: boolean;
	trigger: AssistantTrigger | null;
	/** Whole editor text, for context when writing new SQL. */
	getEditorSql: () => string;
	/** Selection, or the statement under the cursor. */
	getStatementSql: () => string;
	onInsert: (sql: string) => void;
	onReplace: (sql: string) => void;
	onOpenTab: (sql: string) => void;
	onClose: () => void;
	className?: string;
}) {
	const [mode, setMode] = useState<AssistantMode>("generate");
	const [prompt, setPrompt] = useState("");
	const [answer, setAnswer] = useState("");
	const [status, setStatus] = useState<Status>("idle");
	const [error, setError] = useState<string | null>(null);
	const [subject, setSubject] = useState<{ sql?: string; error?: string; prompt?: string } | null>(
		null,
	);
	const abortRef = useRef<AbortController | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const ask = useCallback(
		async (request: { mode: AssistantMode; prompt?: string; sql?: string; error?: string }) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setMode(request.mode);
			setSubject({ sql: request.sql, error: request.error, prompt: request.prompt });
			setAnswer("");
			setError(null);
			setStatus("streaming");
			try {
				const response = await fetch(`/api/databases/${databaseId}/assistant`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(request),
					signal: controller.signal,
				});
				if (!response.ok || !response.body) {
					const body = (await response.json().catch(() => null)) as { error?: string } | null;
					throw new Error(body?.error ?? `The assistant failed (${response.status}).`);
				}
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				let failed: string | null = null;
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						if (!line.trim()) continue;
						const event = JSON.parse(line) as
							| { type: "text"; text: string }
							| { type: "error"; message: string }
							| { type: "done" };
						if (event.type === "text") setAnswer((text) => text + event.text);
						else if (event.type === "error") failed = event.message;
					}
				}
				if (failed) {
					setError(failed);
					setStatus("error");
				} else setStatus("done");
			} catch (caught) {
				if (controller.signal.aborted) {
					setStatus("done");
					return;
				}
				setError(caught instanceof Error ? caught.message : "The assistant failed.");
				setStatus("error");
			}
		},
		[databaseId],
	);

	// "Fix with Claude" and palette actions arrive as triggers from the console.
	const lastNonce = useRef<number | null>(null);
	useEffect(() => {
		if (!trigger || !enabled || trigger.nonce === lastNonce.current) return;
		lastNonce.current = trigger.nonce;
		if (trigger.mode === "generate") {
			setMode("generate");
			textareaRef.current?.focus();
			return;
		}
		void ask({ mode: trigger.mode, sql: trigger.sql, error: trigger.error });
	}, [trigger, enabled, ask]);

	useEffect(() => () => abortRef.current?.abort(), []);

	function submit() {
		if (status === "streaming") return;
		// After a fix, the composer writes SQL: the natural follow-up is "now also…".
		if (mode === "generate" || mode === "fix") {
			const text = prompt.trim();
			if (!text) {
				textareaRef.current?.focus();
				return;
			}
			void ask({ mode: "generate", prompt: text, sql: getEditorSql().slice(0, 8_000) });
		} else {
			const sql = getStatementSql();
			if (!sql.trim()) {
				toast.message("Nothing to explain", {
					description: "Put the cursor in a statement, or select one.",
				});
				return;
			}
			void ask({ mode: "explain", sql, prompt: prompt.trim() || undefined });
		}
	}

	const mod = isMacPlatform() ? "⌘" : "Ctrl";

	return (
		<section aria-label="Ask Claude" className={cn("flex min-h-0 flex-col bg-card", className)}>
			<div className="flex h-10 shrink-0 items-center gap-2 border-border border-b pr-1.5 pl-3">
				<Sparkles className="size-3.5 text-brand-text" />
				<h2 className="font-medium text-[0.8125rem]">Ask Claude</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					className="ml-auto"
					onClick={onClose}
					aria-label="Close assistant"
				>
					<X />
				</Button>
			</div>

			{!enabled ? (
				<div className="flex-1 p-4">
					<div className="rounded-lg border border-border bg-muted/40 p-3.5 text-sm">
						<p className="font-medium">The assistant is not set up here</p>
						<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
							It needs an Anthropic API key on the server. Set{" "}
							<code className="rounded bg-muted px-1 py-px font-mono text-[0.6875rem]">
								ANTHROPIC_API_KEY
							</code>{" "}
							and restart the app. Everything else in the console works without it.
						</p>
					</div>
				</div>
			) : (
				<>
					<div role="tablist" aria-label="Assistant task" className="flex shrink-0 gap-0.5 p-1.5">
						{(
							[
								["generate", "Write SQL"],
								["explain", "Explain query"],
							] as const
						).map(([value, label]) => (
							<button
								key={value}
								type="button"
								role="tab"
								aria-selected={mode === value}
								onClick={() => setMode(value)}
								className={cn(
									"flex h-7 flex-1 items-center justify-center rounded-md text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
									mode === value
										? "bg-accent font-medium text-foreground"
										: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
								)}
							>
								{label}
							</button>
						))}
					</div>

					<div
						className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3"
						aria-live="polite"
					>
						{subject && (subject.sql || subject.prompt) && status !== "idle" && (
							<div className="mb-3 rounded-lg border border-border bg-background/60 px-3 py-2">
								<p className="text-[0.6875rem] text-muted-foreground">
									{mode === "fix" ? "Fixing" : mode === "explain" ? "Explaining" : "You asked"}
								</p>
								<p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[0.6875rem] text-foreground/85">
									{mode === "generate" ? subject.prompt : subject.sql}
								</p>
								{subject.error && (
									<p className="mt-1 line-clamp-2 break-words font-mono text-[0.6875rem] text-destructive">
										{subject.error}
									</p>
								)}
							</div>
						)}

						{status === "idle" ? (
							<p className="px-1 py-6 text-center text-muted-foreground text-xs leading-relaxed">
								{mode === "generate"
									? "Describe the data you want. Claude knows your tables and columns."
									: "Explains the selection, or the statement under the cursor."}
							</p>
						) : (
							<>
								{answer && (
									<Answer
										text={answer}
										streaming={status === "streaming"}
										onInsert={onInsert}
										onReplace={onReplace}
										onOpenTab={onOpenTab}
									/>
								)}
								{status === "streaming" && !answer && (
									<p className="flex items-center gap-2 px-1 py-3 text-muted-foreground text-xs">
										<Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
										Thinking…
									</p>
								)}
								{error && (
									<p
										role="alert"
										className="mt-2 rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-destructive text-xs"
									>
										{error}
									</p>
								)}
							</>
						)}
					</div>

					<form
						className="shrink-0 border-border border-t p-2"
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
					>
						<label htmlFor="assistant-prompt" className="sr-only">
							{mode === "explain"
								? "Optional question about the query"
								: "Describe the query you want"}
						</label>
						<div className="rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
							<textarea
								id="assistant-prompt"
								ref={textareaRef}
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
										e.preventDefault();
										submit();
									}
								}}
								rows={mode === "explain" ? 2 : 3}
								maxLength={4000}
								placeholder={
									mode === "explain"
										? "Optional: what do you want to know about it?"
										: "Top 10 customers by revenue this year, with their country…"
								}
								className="block w-full resize-none bg-transparent px-3 pt-2 text-[0.8125rem] outline-none placeholder:text-muted-foreground"
							/>
							<div className="flex items-center justify-between gap-2 px-2 pb-2">
								<span className="text-[0.6875rem] text-muted-foreground">{mod}+Enter to send</span>
								{status === "streaming" ? (
									<Button
										type="button"
										size="sm"
										variant="secondary"
										onClick={() => abortRef.current?.abort()}
									>
										<Square data-icon="inline-start" />
										Stop
									</Button>
								) : (
									<Button type="submit" size="sm">
										<ArrowUp data-icon="inline-start" />
										{mode === "explain" ? "Explain" : "Write SQL"}
									</Button>
								)}
							</div>
						</div>
						<p className="mt-1.5 px-1 text-[0.625rem] text-muted-foreground leading-relaxed">
							Claude sees your schema and this SQL, never your data or credentials. It only
							suggests; you decide what runs.
						</p>
					</form>
				</>
			)}
		</section>
	);
}

/* ------------------------------------------------------------------ *
 * Answer rendering: paragraphs, bullets, inline code and SQL blocks
 * ------------------------------------------------------------------ */

function Answer({
	text,
	streaming,
	onInsert,
	onReplace,
	onOpenTab,
}: {
	text: string;
	streaming: boolean;
	onInsert: (sql: string) => void;
	onReplace: (sql: string) => void;
	onOpenTab: (sql: string) => void;
}) {
	const parts: { kind: "text" | "code"; body: string; open?: boolean }[] = [];
	const fence = /```[a-zA-Z]*\n?([\s\S]*?)(```|$)/g;
	let last = 0;
	for (const match of text.matchAll(fence)) {
		if (match.index > last) parts.push({ kind: "text", body: text.slice(last, match.index) });
		parts.push({ kind: "code", body: match[1].replace(/\n$/, ""), open: match[2] !== "```" });
		last = match.index + match[0].length;
	}
	if (last < text.length) parts.push({ kind: "text", body: text.slice(last) });

	return (
		<div className="space-y-2.5 text-[0.8125rem] leading-relaxed">
			{parts.map((part, i) =>
				part.kind === "code" ? (
					<CodeBlock
						key={i}
						sql={part.body}
						complete={!part.open || !streaming}
						onInsert={onInsert}
						onReplace={onReplace}
						onOpenTab={onOpenTab}
					/>
				) : (
					<Prose key={i} text={part.body} />
				),
			)}
		</div>
	);
}

function inline(text: string): ReactNode[] {
	return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((piece, i) => {
		if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 1) {
			return (
				<code key={i} className="rounded bg-muted px-1 py-px font-mono text-[0.75rem]">
					{piece.slice(1, -1)}
				</code>
			);
		}
		if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 3) {
			return <strong key={i}>{piece.slice(2, -2)}</strong>;
		}
		return <Fragment key={i}>{piece}</Fragment>;
	});
}

function Prose({ text }: { text: string }) {
	const blocks = text
		.trim()
		.split(/\n{2,}/)
		.filter(Boolean);
	return (
		<>
			{blocks.map((block, i) => {
				const lines = block.split("\n");
				if (lines.every((line) => /^\s*([-*]|\d+\.)\s+/.test(line))) {
					return (
						<ul key={i} className="list-disc space-y-1 pl-4 marker:text-muted-foreground">
							{lines.map((line, j) => (
								<li key={j}>{inline(line.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>
							))}
						</ul>
					);
				}
				return (
					<p key={i} className="text-foreground/90">
						{inline(block)}
					</p>
				);
			})}
		</>
	);
}

function CodeBlock({
	sql,
	complete,
	onInsert,
	onReplace,
	onOpenTab,
}: {
	sql: string;
	complete: boolean;
	onInsert: (sql: string) => void;
	onReplace: (sql: string) => void;
	onOpenTab: (sql: string) => void;
}) {
	return (
		<div className="overflow-hidden rounded-lg border border-border">
			<pre className="max-h-72 overflow-auto bg-[var(--code-background)] px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed">
				{sql}
			</pre>
			{complete && sql.trim() && (
				<div className="flex flex-wrap items-center gap-1 border-border border-t bg-muted/30 p-1">
					<Button variant="ghost" size="xs" onClick={() => onInsert(sql)}>
						<TextCursorInput data-icon="inline-start" />
						Insert
					</Button>
					<Button variant="ghost" size="xs" onClick={() => onReplace(sql)}>
						<Replace data-icon="inline-start" />
						Replace editor
					</Button>
					<Button variant="ghost" size="xs" onClick={() => onOpenTab(sql)}>
						<FilePlus2 data-icon="inline-start" />
						New tab
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						className="ml-auto"
						aria-label="Copy SQL"
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(sql);
								toast.success("Copied SQL");
							} catch {
								toast.error("Clipboard is not available");
							}
						}}
					>
						<ClipboardCopy />
					</Button>
				</div>
			)}
		</div>
	);
}

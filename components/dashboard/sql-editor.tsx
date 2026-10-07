"use client";

import { sql as sqlLang } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { CircleAlert, Loader2, Play, Rows3 } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { runQueryAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { QueryOutcome } from "@/lib/query";
import { cn } from "@/lib/utils";

const STARTER = "select * from information_schema.tables\nwhere table_schema = 'public';";

/**
 * Editor chrome and syntax colours read from CSS variables, so one theme serves both
 * modes and switches with the rest of the page instead of via a prop.
 */
const editorTheme = EditorView.theme({
	"&": {
		backgroundColor: "var(--code-background)",
		color: "var(--foreground)",
		fontSize: "13px",
	},
	".cm-content": {
		fontFamily: "var(--font-mono)",
		padding: "12px 0",
		caretColor: "var(--brand)",
	},
	".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--brand)", borderLeftWidth: "2px" },
	"&.cm-focused": { outline: "none" },
	".cm-gutters": {
		backgroundColor: "var(--code-background)",
		color: "color-mix(in oklab, var(--muted-foreground) 60%, transparent)",
		border: "none",
		fontFamily: "var(--font-mono)",
	},
	".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px", minWidth: "40px" },
	".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
	".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--foreground) 3%, transparent)" },
	"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
		{ backgroundColor: "color-mix(in oklab, var(--brand) 22%, transparent) !important" },
	".cm-tooltip": {
		backgroundColor: "var(--popover)",
		border: "1px solid var(--border)",
		borderRadius: "6px",
		overflow: "hidden",
	},
	".cm-tooltip-autocomplete > ul > li[aria-selected]": {
		backgroundColor: "var(--accent)",
		color: "var(--foreground)",
	},
});

const highlight = HighlightStyle.define([
	{ tag: [tags.keyword, tags.operatorKeyword], color: "var(--foreground)", fontWeight: "600" },
	{ tag: [tags.string, tags.special(tags.string)], color: "var(--brand-text)" },
	{ tag: [tags.number, tags.bool, tags.null], color: "var(--brand-text)" },
	{
		tag: [tags.comment, tags.lineComment, tags.blockComment],
		color: "var(--muted-foreground)",
		fontStyle: "italic",
	},
	{ tag: [tags.operator, tags.punctuation, tags.separator], color: "var(--muted-foreground)" },
	{ tag: [tags.typeName, tags.standard(tags.name)], color: "var(--foreground)" },
	{
		tag: [tags.name, tags.propertyName],
		color: "color-mix(in oklab, var(--foreground) 82%, transparent)",
	},
]);

export function SqlEditor({ databaseId }: { databaseId: string }) {
	const [value, setValue] = useState(STARTER);
	const [result, setResult] = useState<QueryOutcome | null>(null);
	const [pending, start] = useTransition();
	// The keymap is built once; the ref keeps it reading the latest editor contents.
	const latest = useRef(value);
	latest.current = value;

	function run() {
		start(async () => setResult(await runQueryAction(databaseId, latest.current)));
	}
	const runRef = useRef(run);
	runRef.current = run;

	const extensions = useMemo(
		() => [
			sqlLang(),
			editorTheme,
			syntaxHighlighting(highlight),
			keymap.of([
				{
					key: "Mod-Enter",
					run: () => {
						runRef.current();
						return true;
					},
				},
			]),
		],
		[],
	);

	return (
		<div className="space-y-4">
			<div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
				<div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-4 py-2.5">
					<p className="text-muted-foreground text-xs">
						Runs as <span className="text-foreground">your database role</span>, with the same
						privileges as a direct connection
					</p>
					<div className="flex items-center gap-3">
						<span className="hidden items-center gap-1 text-muted-foreground text-xs sm:flex">
							<Kbd>Ctrl</Kbd>
							<Kbd>Enter</Kbd>
						</span>
						<Button size="sm" onClick={run} disabled={pending}>
							{pending ? (
								<Loader2 className="animate-spin" data-icon="inline-start" />
							) : (
								<Play data-icon="inline-start" />
							)}
							{pending ? "Running…" : "Run"}
						</Button>
					</div>
				</div>

				<CodeMirror
					value={value}
					onChange={setValue}
					extensions={extensions}
					theme="none"
					height="260px"
					aria-label="SQL query"
					basicSetup={{
						lineNumbers: true,
						foldGutter: false,
						highlightActiveLine: true,
						syntaxHighlighting: false,
					}}
				/>
			</div>

			{pending && !result && <ResultsSkeleton />}
			{result && <Results result={result} pending={pending} />}
		</div>
	);
}

function ResultsSkeleton() {
	return (
		<div className="overflow-hidden rounded-xl border border-border bg-card">
			<div className="h-10 border-border border-b" />
			<div className="space-y-2.5 p-4">
				{[72, 56, 64, 48].map((width) => (
					<div
						key={width}
						className="h-3 animate-pulse rounded bg-foreground/[0.06] motion-reduce:animate-none"
						style={{ width: `${width}%` }}
					/>
				))}
			</div>
		</div>
	);
}

function Results({ result, pending }: { result: QueryOutcome; pending: boolean }) {
	if (!result.ok) {
		return (
			<div
				role="alert"
				className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3.5"
			>
				<div className="flex items-start gap-2.5">
					<CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
					<div className="min-w-0">
						<p className="font-medium text-destructive text-sm">Query failed</p>
						{/* The engine's own message, verbatim: it is far more useful than anything we
						    could substitute, and it only describes the user's own database. */}
						<p className="mt-1 break-words font-mono text-muted-foreground text-xs">
							{result.error}
						</p>
					</div>
				</div>
			</div>
		);
	}

	const hasRows = (result.columns?.length ?? 0) > 0;

	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-opacity",
				pending && "opacity-60",
			)}
		>
			<div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-4 py-2.5 text-xs">
				<p className="flex items-center gap-2 text-muted-foreground">
					<Rows3 className="size-3.5" />
					{hasRows
						? `${result.rowCount} row${result.rowCount === 1 ? "" : "s"}`
						: (result.command ?? "OK")}
					{result.truncated && (
						<span className="text-warning">showing first {result.rows?.length}</span>
					)}
				</p>
				<p className="font-mono text-muted-foreground tabular-nums">{result.durationMs}ms</p>
			</div>

			{hasRows ? (
				<div className="max-h-[440px] overflow-auto">
					<table className="w-full text-left text-xs">
						<thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--border)]">
							<tr>
								{result.columns?.map((column) => (
									<th
										key={column}
										className="whitespace-nowrap px-4 py-2 font-medium text-muted-foreground"
									>
										{column}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{result.rows?.map((row, rowIndex) => (
								// Result rows have no stable identity; the index is the only key available.
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
			) : (
				<p className="px-4 py-8 text-center text-muted-foreground text-sm">
					Statement completed with no rows returned.
				</p>
			)}
		</div>
	);
}

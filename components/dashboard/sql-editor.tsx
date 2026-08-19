"use client";

import { sql as sqlLang } from "@codemirror/lang-sql";
import CodeMirror from "@uiw/react-codemirror";
import { CircleAlert, Loader2, Play } from "lucide-react";
import { useState, useTransition } from "react";
import { runQueryAction } from "@/app/actions";
import type { QueryOutcome } from "@/lib/query";
import { cn } from "@/lib/utils";

const STARTER = "select * from information_schema.tables\nwhere table_schema = 'public';";

export function SqlEditor({ databaseId }: { databaseId: string }) {
	const [value, setValue] = useState(STARTER);
	const [result, setResult] = useState<QueryOutcome | null>(null);
	const [pending, start] = useTransition();

	function run() {
		start(async () => setResult(await runQueryAction(databaseId, value)));
	}

	return (
		<div className="space-y-4">
			<div className="overflow-hidden rounded-xl border border-border bg-card">
				<div className="flex items-center justify-between gap-4 border-border border-b px-4 py-2.5">
					<p className="text-muted-foreground text-xs">
						Runs as <span className="font-mono text-foreground">your database role</span> — same
						privileges as a direct connection
					</p>
					<button
						type="button"
						onClick={run}
						disabled={pending}
						className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm disabled:opacity-60"
					>
						{pending ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<Play className="size-3.5" />
						)}
						{pending ? "Running" : "Run"}
					</button>
				</div>

				<CodeMirror
					value={value}
					onChange={setValue}
					extensions={[sqlLang()]}
					theme="dark"
					height="240px"
					basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
				/>
			</div>

			{result && <Results result={result} />}
		</div>
	);
}

function Results({ result }: { result: QueryOutcome }) {
	if (!result.ok) {
		return (
			<div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
				<div className="flex items-start gap-2.5">
					<CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
					<div className="min-w-0">
						<p className="font-medium text-destructive text-sm">Query failed</p>
						{/* Postgres' own message, verbatim — it is far more useful than anything we
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
		<div className="overflow-hidden rounded-xl border border-border bg-card">
			<div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-5 py-3 text-xs">
				<p className="text-muted-foreground">
					{hasRows
						? `${result.rowCount} row${result.rowCount === 1 ? "" : "s"}`
						: (result.command ?? "OK")}
					{result.truncated && (
						<span className="ml-2 text-warning">showing first {result.rows?.length}</span>
					)}
				</p>
				<p className="text-muted-foreground tabular-nums">{result.durationMs}ms</p>
			</div>

			{hasRows ? (
				<div className="max-h-[420px] overflow-auto">
					<table className="w-full text-left text-xs">
						<thead className="sticky top-0 bg-card">
							<tr className="border-border border-b">
								{result.columns?.map((column) => (
									<th
										key={column}
										className="whitespace-nowrap px-4 py-2.5 font-medium text-muted-foreground"
									>
										{column}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{result.rows?.map((row, rowIndex) => (
								// Result rows have no stable identity — the index is the only key available.
								<tr key={rowIndex} className="hover:bg-accent/40">
									{row.map((cell, cellIndex) => (
										<td
											key={cellIndex}
											className={cn(
												"max-w-[320px] truncate px-4 py-2 font-mono",
												cell === null && "text-muted-foreground/50 italic",
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
				<p className="px-5 py-8 text-center text-muted-foreground text-sm">
					Statement completed with no rows returned.
				</p>
			)}
		</div>
	);
}

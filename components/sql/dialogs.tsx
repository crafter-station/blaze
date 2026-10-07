"use client";

import { ClipboardCopy, FilePlus2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DestructiveFinding } from "@/lib/sql/destructive";

export interface PendingConfirmation {
	flagged: { text: string; finding: DestructiveFinding }[];
	total: number;
	run: () => void;
}

/**
 * Asks before DROP, TRUNCATE, ALTER … DROP and unqualified DELETE/UPDATE run, showing
 * exactly which statements tripped it. Cancel is the default focus.
 */
export function ConfirmDestructive({
	pending,
	onClose,
}: {
	pending: PendingConfirmation | null;
	onClose: () => void;
}) {
	const count = pending?.flagged.length ?? 0;
	return (
		<AlertDialog open={!!pending} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent className="sm:max-w-lg">
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<TriangleAlert className="size-4 text-destructive" />
						{count === 1
							? "This statement can destroy data"
							: `${count} statements can destroy data`}
					</AlertDialogTitle>
					<AlertDialogDescription>
						It runs as your database role and cannot be undone from here. Check it before running.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<ul className="max-h-[45dvh] space-y-2 overflow-y-auto">
					{pending?.flagged.map(({ text, finding }, i) => (
						<li key={i} className="overflow-hidden rounded-lg border border-destructive/25">
							<p className="border-destructive/20 border-b bg-destructive/[0.06] px-3 py-1.5 font-medium text-destructive text-xs">
								{finding.label}
							</p>
							<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words bg-[var(--code-background)] px-3 py-2 font-mono text-xs leading-relaxed">
								{text.length > 1200 ? `${text.slice(0, 1200)}…` : text}
							</pre>
						</li>
					))}
				</ul>
				{pending && pending.total > count && (
					<p className="text-muted-foreground text-xs">
						The batch has {pending.total} statements; the others are not flagged.
					</p>
				)}
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

export function DdlDialog({
	state,
	onClose,
	onOpenInTab,
}: {
	state: { title: string; ddl: string | null; error: string | null } | null;
	onClose: () => void;
	onOpenInTab: (sql: string, title: string) => void;
}) {
	return (
		<Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="font-mono text-base">{state?.title}</DialogTitle>
					<DialogDescription>Definition as the engine reports it.</DialogDescription>
				</DialogHeader>
				{state?.error ? (
					<p role="alert" className="font-mono text-destructive text-xs">
						{state.error}
					</p>
				) : (
					<pre className="max-h-[55dvh] min-h-24 overflow-auto rounded-lg border border-border bg-[var(--code-background)] p-3 font-mono text-xs leading-relaxed">
						{state?.ddl ?? "Loading…"}
					</pre>
				)}
				<DialogFooter>
					<Button
						variant="outline"
						size="sm"
						disabled={!state?.ddl}
						onClick={async () => {
							if (!state?.ddl) return;
							try {
								await navigator.clipboard.writeText(state.ddl);
								toast.success("Copied definition");
							} catch {
								toast.error("Clipboard is not available");
							}
						}}
					>
						<ClipboardCopy data-icon="inline-start" />
						Copy
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={!state?.ddl}
						onClick={() => {
							if (state?.ddl) onOpenInTab(state.ddl, state.title);
							onClose();
						}}
					>
						<FilePlus2 data-icon="inline-start" />
						Open in new tab
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Name a query to save it, or rename one that is already saved. */
export function NameDialog({
	state,
	onClose,
	onSubmit,
}: {
	state: { title: string; action: string; initial: string } | null;
	onClose: () => void;
	onSubmit: (name: string) => Promise<string | null>;
}) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	return (
		<Dialog
			open={!!state}
			onOpenChange={(open) => {
				if (!open) {
					setError(null);
					onClose();
				}
			}}
		>
			<DialogContent className="sm:max-w-md">
				<form
					className="grid gap-4"
					onSubmit={async (event) => {
						event.preventDefault();
						const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
						if (!name) {
							setError("Give the query a name.");
							return;
						}
						setBusy(true);
						const failure = await onSubmit(name);
						setBusy(false);
						if (failure) setError(failure);
						else {
							setError(null);
							onClose();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>{state?.title}</DialogTitle>
						<DialogDescription>
							Saved queries are private to you and this database.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2">
						<Label htmlFor="saved-query-name">Name</Label>
						<Input
							id="saved-query-name"
							name="name"
							defaultValue={state?.initial}
							maxLength={120}
							autoComplete="off"
							spellCheck={false}
							autoFocus
							aria-invalid={!!error}
							aria-describedby={error ? "saved-query-error" : undefined}
						/>
						{error && (
							<p id="saved-query-error" role="alert" className="text-destructive text-xs">
								{error}
							</p>
						)}
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={busy}>
							{busy ? "Saving…" : state?.action}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function ConfirmDelete({
	name,
	onClose,
	onConfirm,
}: {
	name: string | null;
	onClose: () => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={!!name} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent className="sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
					<AlertDialogDescription>
						The saved query is removed for good. Open tabs keep their text.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() => {
							onConfirm();
							onClose();
						}}
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** EXPLAIN ANALYZE executes the statement; ask first when it is not a plain read. */
export function ConfirmAnalyze({
	statement,
	engine,
	onClose,
	onConfirm,
}: {
	statement: string | null;
	engine: string;
	onClose: () => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={!!statement} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent className="sm:max-w-lg">
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<TriangleAlert className="size-4 text-warning" />
						ANALYZE runs this statement
					</AlertDialogTitle>
					<AlertDialogDescription>
						To measure real rows and timings the statement executes inside a transaction that is
						rolled back afterwards.{" "}
						{engine === "postgres"
							? "Sequences still advance and functions with side effects still run."
							: "DDL commits implicitly in MySQL and MariaDB and cannot be rolled back."}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-[var(--code-background)] px-3 py-2 font-mono text-xs leading-relaxed">
					{statement && statement.length > 1200 ? `${statement.slice(0, 1200)}…` : statement}
				</pre>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							onConfirm();
							onClose();
						}}
					>
						Run with ANALYZE
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

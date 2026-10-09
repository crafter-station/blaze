"use client";

import { Loader2, TriangleAlert, WandSparkles } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { isMacPlatform } from "@/components/console-shell/hooks";
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
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { LiteralParseError, parseLiteral, toShell } from "@/lib/mongo/literal";
import { CodeEditor } from "./code-editor";

/**
 * Dialogs for changing data in the Mongo Browser and confirming shell commands. Each
 * submits through a callback that returns an error message or null, so a failure (a
 * duplicate key, a validator, a race) stays next to what the user typed.
 */

export type Submit = () => Promise<string | null>;

function ErrorText({ id, error }: { id?: string; error: string | null }) {
	if (!error) return null;
	return (
		<p
			id={id}
			role="alert"
			className="whitespace-pre-wrap text-destructive text-xs leading-relaxed"
		>
			{error}
		</p>
	);
}

function Spinner() {
	return <Loader2 className="animate-spin motion-reduce:animate-none" data-icon="inline-start" />;
}

/** Where a parse error is, as "line 3, column 7". */
export function describeParseError(text: string, error: unknown): string {
	if (!(error instanceof LiteralParseError))
		return error instanceof Error ? error.message : String(error);
	const before = text.slice(0, error.position);
	const line = before.split("\n").length;
	const column = before.length - before.lastIndexOf("\n");
	return `${error.message} (line ${line}, column ${column})`;
}

/* ------------------------------------------------------------------ *
 * Edit / insert a document
 * ------------------------------------------------------------------ */

export function DocumentDialog({
	state,
	onClose,
}: {
	state: {
		title: string;
		description: ReactNode;
		initial: string;
		submitLabel: string;
		submit: (text: string) => Promise<string | null>;
	} | null;
	onClose: () => void;
}) {
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (state) {
			setText(state.initial);
			setError(null);
			setBusy(false);
		}
	}, [state]);

	const save = async () => {
		if (!state || busy) return;
		try {
			parseLiteral(text);
		} catch (e) {
			setError(describeParseError(text, e));
			return;
		}
		setBusy(true);
		const failure = await state.submit(text);
		setBusy(false);
		if (failure) setError(failure);
		else onClose();
	};

	const format = () => {
		try {
			setText(toShell(parseLiteral(text)));
			setError(null);
		} catch (e) {
			setError(describeParseError(text, e));
		}
	};

	return (
		<Dialog open={!!state} onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent className="gap-4 sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{state?.title}</DialogTitle>
					<DialogDescription>{state?.description}</DialogDescription>
				</DialogHeader>
				<div className="overflow-hidden rounded-lg border border-border">
					{state && (
						<CodeEditor
							value={text}
							onChange={setText}
							onSubmit={() => void save()}
							ariaLabel="Document, in Extended JSON or shell syntax"
							lineNumbers
							minHeight="280px"
							maxHeight="min(60vh, 560px)"
							autoFocus
						/>
					)}
				</div>
				<ErrorText error={error} />
				<DialogFooter className="items-center sm:justify-between">
					<p className="hidden text-muted-foreground text-xs sm:block">
						Shell syntax works: <code className="font-mono">ObjectId("…")</code>,{" "}
						<code className="font-mono">ISODate("…")</code>, unquoted keys.
					</p>
					<div className="flex gap-2">
						<Button variant="ghost" size="sm" onClick={format} disabled={busy}>
							<WandSparkles data-icon="inline-start" />
							Format
						</Button>
						<Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
							Cancel
						</Button>
						<Button size="sm" onClick={() => void save()} disabled={busy}>
							{busy && <Spinner />}
							{state?.submitLabel}
							<Kbd className="ml-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex">
								{isMacPlatform() ? "⌘↵" : "Ctrl ↵"}
							</Kbd>
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/* ------------------------------------------------------------------ *
 * Confirm a destructive action, optionally by typing a name
 * ------------------------------------------------------------------ */

export interface ConfirmState {
	title: string;
	description: ReactNode;
	detail?: ReactNode;
	confirmLabel: string;
	/** When set, the confirm button stays disabled until exactly this is typed. */
	typeToConfirm?: string;
	run: Submit;
}

export function ConfirmDialog({
	state,
	onClose,
}: {
	state: ConfirmState | null;
	onClose: () => void;
}) {
	const [typed, setTyped] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const id = useId();
	useEffect(() => {
		if (state) {
			setTyped("");
			setError(null);
			setBusy(false);
		}
	}, [state]);
	const blocked = !!state?.typeToConfirm && typed !== state.typeToConfirm;

	return (
		<AlertDialog open={!!state} onOpenChange={(open) => !open && !busy && onClose()}>
			<AlertDialogContent className="sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<TriangleAlert className="size-4 shrink-0 text-destructive" />
						{state?.title}
					</AlertDialogTitle>
					<AlertDialogDescription>{state?.description}</AlertDialogDescription>
				</AlertDialogHeader>
				{state?.detail}
				{state?.typeToConfirm && (
					<div className="grid gap-2">
						<Label htmlFor={`${id}-confirm`}>
							Type <span className="font-medium font-mono">{state.typeToConfirm}</span> to confirm
						</Label>
						<Input
							id={`${id}-confirm`}
							value={typed}
							onChange={(e) => setTyped(e.target.value)}
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							autoFocus
						/>
					</div>
				)}
				<ErrorText error={error} />
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={busy || blocked}
						onClick={async (event) => {
							event.preventDefault();
							if (!state) return;
							setBusy(true);
							const failure = await state.run();
							setBusy(false);
							if (failure) setError(failure);
							else onClose();
						}}
					>
						{busy && <Spinner />}
						{state?.confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/* ------------------------------------------------------------------ *
 * New collection
 * ------------------------------------------------------------------ */

export function CreateCollectionDialog({
	open,
	onClose,
	onCreate,
}: {
	open: boolean;
	onClose: () => void;
	onCreate: (name: string, options: string) => Promise<string | null>;
}) {
	const [name, setName] = useState("");
	const [options, setOptions] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const id = useId();
	useEffect(() => {
		if (open) {
			setName("");
			setOptions("");
			setError(null);
			setBusy(false);
		}
	}, [open]);

	const submit = async () => {
		if (!name.trim() || busy) return;
		setBusy(true);
		const failure = await onCreate(name.trim(), options);
		setBusy(false);
		if (failure) setError(failure);
		else onClose();
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>New collection</DialogTitle>
					<DialogDescription>
						Collections are also created on the first insert; this is for options such as a
						validator, capped size or time series.
					</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						void submit();
					}}
				>
					<div className="grid gap-2">
						<Label htmlFor={`${id}-name`}>Name</Label>
						<Input
							id={`${id}-name`}
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="font-mono"
							placeholder="events"
							autoComplete="off"
							spellCheck={false}
							autoFocus
						/>
					</div>
					<div className="grid gap-2">
						<Label>
							Options <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<div className="overflow-hidden rounded-md border border-input">
							<CodeEditor
								value={options}
								onChange={setOptions}
								ariaLabel="Collection options"
								placeholder="{ capped: true, size: 1048576 }"
								minHeight="64px"
								maxHeight="200px"
							/>
						</div>
					</div>
					<ErrorText error={error} />
					<DialogFooter>
						<Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
							Cancel
						</Button>
						<Button type="submit" size="sm" disabled={busy || !name.trim()}>
							{busy && <Spinner />}
							Create collection
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/* ------------------------------------------------------------------ *
 * New index
 * ------------------------------------------------------------------ */

export interface IndexDraft {
	keys: string;
	name: string;
	unique: boolean;
	sparse: boolean;
	ttl: string;
	options: string;
}

export function CreateIndexDialog({
	collection,
	open,
	onClose,
	onCreate,
}: {
	collection: string;
	open: boolean;
	onClose: () => void;
	onCreate: (draft: IndexDraft) => Promise<string | null>;
}) {
	const empty: IndexDraft = {
		keys: "{  }",
		name: "",
		unique: false,
		sparse: false,
		ttl: "",
		options: "",
	};
	const [draft, setDraft] = useState<IndexDraft>(empty);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const id = useId();
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens.
	useEffect(() => {
		if (open) {
			setDraft(empty);
			setError(null);
			setBusy(false);
		}
	}, [open]);
	const set = <K extends keyof IndexDraft>(key: K, value: IndexDraft[K]) =>
		setDraft((d) => ({ ...d, [key]: value }));

	const submit = async () => {
		if (busy) return;
		try {
			parseLiteral(draft.keys);
		} catch (e) {
			setError(describeParseError(draft.keys, e));
			return;
		}
		setBusy(true);
		const failure = await onCreate(draft);
		setBusy(false);
		if (failure) setError(failure);
		else onClose();
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>New index on {collection}</DialogTitle>
					<DialogDescription>
						Keys map fields to <code className="font-mono">1</code>,{" "}
						<code className="font-mono">-1</code>, <code className="font-mono">"text"</code>,{" "}
						<code className="font-mono">"2dsphere"</code> or{" "}
						<code className="font-mono">"hashed"</code>. Building runs on the server and can take a
						moment on a large collection.
					</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						void submit();
					}}
				>
					<div className="grid gap-2">
						<Label>Keys</Label>
						<div className="overflow-hidden rounded-md border border-input">
							<CodeEditor
								value={draft.keys}
								onChange={(v) => set("keys", v)}
								onSubmit={() => void submit()}
								ariaLabel="Index keys"
								placeholder="{ status: 1, placedAt: -1 }"
								singleLine
								autoFocus
							/>
						</div>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-2">
							<Label htmlFor={`${id}-name`}>
								Name <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id={`${id}-name`}
								value={draft.name}
								onChange={(e) => set("name", e.target.value)}
								className="font-mono"
								placeholder="generated from the keys"
								autoComplete="off"
								spellCheck={false}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor={`${id}-ttl`}>
								TTL, seconds <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id={`${id}-ttl`}
								value={draft.ttl}
								onChange={(e) => set("ttl", e.target.value.replace(/[^\d]/g, ""))}
								inputMode="numeric"
								placeholder="on a date field"
								className="tabular-nums"
							/>
						</div>
					</div>
					<div className="flex flex-wrap gap-x-6 gap-y-2">
						{(
							[
								["unique", "Unique", "Reject documents that repeat these values"],
								["sparse", "Sparse", "Skip documents without the field"],
							] as const
						).map(([key, label, hint]) => (
							<label key={key} className="flex cursor-pointer items-start gap-2 text-sm">
								<input
									type="checkbox"
									checked={draft[key]}
									onChange={(e) => set(key, e.target.checked)}
									className="mt-0.5 size-4 accent-[var(--brand)]"
								/>
								<span>
									{label}
									<span className="block text-muted-foreground text-xs">{hint}</span>
								</span>
							</label>
						))}
					</div>
					<div className="grid gap-2">
						<Label>
							More options <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<div className="overflow-hidden rounded-md border border-input">
							<CodeEditor
								value={draft.options}
								onChange={(v) => set("options", v)}
								ariaLabel="More index options"
								placeholder="{ partialFilterExpression: { status: 'paid' } }"
								singleLine
							/>
						</div>
					</div>
					<ErrorText error={error} />
					<DialogFooter>
						<Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
							Cancel
						</Button>
						<Button type="submit" size="sm" disabled={busy}>
							{busy && <Spinner />}
							Create index
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

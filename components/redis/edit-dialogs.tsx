"use client";

import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatTtl, typeLabel } from "@/lib/redis/keys";
import { cn } from "@/lib/utils";
import { TypeBadge } from "./type-badge";

/**
 * Dialogs for changing data in the key browser. Each submits through a callback that
 * returns an error message or null, so failures (a full database, a race with another
 * client) stay in the dialog next to what the user typed instead of vanishing into a toast.
 */

export type Submit<T> = (values: T) => Promise<string | null>;

function ErrorText({ id, error }: { id: string; error: string | null }) {
	if (!error) return null;
	return (
		<p id={id} role="alert" className="text-destructive text-xs leading-relaxed">
			{error}
		</p>
	);
}

/* ------------------------------------------------------------------ *
 * A small generic form: an element, a field, a member, an entry
 * ------------------------------------------------------------------ */

export interface FieldSpec {
	name: string;
	label: string;
	kind: "input" | "textarea" | "select";
	initial: string;
	placeholder?: string;
	hint?: string;
	options?: { value: string; label: string }[];
	mono?: boolean;
	/** Returns an error message for invalid input. */
	validate?: (value: string) => string | null;
}

export interface FormState {
	title: string;
	description?: ReactNode;
	fields: FieldSpec[];
	submitLabel: string;
	submit: Submit<Record<string, string>>;
	/** A destructive secondary action, e.g. "Delete field". */
	remove?: { label: string; run: () => Promise<string | null> };
}

export function FormDialog({ state, onClose }: { state: FormState | null; onClose: () => void }) {
	const [values, setValues] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"save" | "remove" | null>(null);
	const errorId = useId();

	useEffect(() => {
		if (!state) return;
		setValues(Object.fromEntries(state.fields.map((f) => [f.name, f.initial])));
		setError(null);
		setBusy(null);
	}, [state]);

	async function run(kind: "save" | "remove") {
		if (!state) return;
		if (kind === "save") {
			for (const field of state.fields) {
				const problem = field.validate?.(values[field.name] ?? "");
				if (problem) {
					setError(problem);
					return;
				}
			}
		}
		setBusy(kind);
		const failure =
			kind === "save" ? await state.submit(values) : await (state.remove?.run() ?? null);
		setBusy(null);
		if (failure) setError(failure);
		else onClose();
	}

	return (
		<Dialog open={!!state} onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void run("save");
					}}
				>
					<DialogHeader>
						<DialogTitle>{state?.title}</DialogTitle>
						{state?.description && <DialogDescription>{state.description}</DialogDescription>}
					</DialogHeader>
					{state?.fields.map((field, i) => {
						const id = `${errorId}-${field.name}`;
						const value = values[field.name] ?? "";
						const set = (next: string) => setValues((v) => ({ ...v, [field.name]: next }));
						return (
							<div key={field.name} className="grid gap-2">
								<Label htmlFor={id}>{field.label}</Label>
								{field.kind === "textarea" ? (
									<Textarea
										id={id}
										value={value}
										onChange={(e) => set(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
												e.preventDefault();
												void run("save");
											}
										}}
										placeholder={field.placeholder}
										spellCheck={false}
										autoFocus={i === 0}
										aria-invalid={!!error}
										aria-describedby={error ? errorId : undefined}
										className={cn(
											"max-h-[40dvh] min-h-24 resize-y text-[0.8125rem]",
											field.mono !== false && "font-mono",
										)}
									/>
								) : field.kind === "select" ? (
									<Select value={value} onValueChange={set}>
										<SelectTrigger id={id} className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{field.options?.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : (
									<Input
										id={id}
										value={value}
										onChange={(e) => set(e.target.value)}
										placeholder={field.placeholder}
										spellCheck={false}
										autoComplete="off"
										autoFocus={i === 0}
										aria-invalid={!!error}
										aria-describedby={error ? errorId : undefined}
										className={cn(field.mono !== false && "font-mono text-[0.8125rem]")}
									/>
								)}
								{field.hint && <p className="text-muted-foreground text-xs">{field.hint}</p>}
							</div>
						);
					})}
					<ErrorText id={errorId} error={error} />
					<DialogFooter className="sm:justify-between">
						{state?.remove ? (
							<Button
								type="button"
								variant="ghost"
								className="text-destructive hover:bg-destructive/10 hover:text-destructive"
								onClick={() => void run("remove")}
								disabled={!!busy}
							>
								{busy === "remove" ? (
									<Loader2
										className="animate-spin motion-reduce:animate-none"
										data-icon="inline-start"
									/>
								) : (
									<Trash2 data-icon="inline-start" />
								)}
								{state.remove.label}
							</Button>
						) : (
							<span />
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row">
							<Button type="button" variant="outline" onClick={onClose} disabled={!!busy}>
								Cancel
							</Button>
							<Button type="submit" disabled={!!busy}>
								{busy === "save" && (
									<Loader2
										className="animate-spin motion-reduce:animate-none"
										data-icon="inline-start"
									/>
								)}
								{state?.submitLabel}
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/* ------------------------------------------------------------------ *
 * TTL
 * ------------------------------------------------------------------ */

const UNITS = [
	{ value: "1", label: "seconds" },
	{ value: "60", label: "minutes" },
	{ value: "3600", label: "hours" },
	{ value: "86400", label: "days" },
];

export function TtlDialog({
	open,
	name,
	ttl,
	onClose,
	onSet,
	onPersist,
}: {
	open: boolean;
	name: string;
	/** Current TTL in ms; -1 for none. */
	ttl: number;
	onClose: () => void;
	onSet: (seconds: number) => Promise<string | null>;
	onPersist: () => Promise<string | null>;
}) {
	const [amount, setAmount] = useState("1");
	const [unit, setUnit] = useState("3600");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const id = useId();

	useEffect(() => {
		if (!open) return;
		setError(null);
		setBusy(false);
		if (ttl > 0) {
			const seconds = Math.ceil(ttl / 1000);
			const best = [...UNITS].reverse().find((u) => seconds % Number(u.value) === 0) ?? UNITS[0];
			setUnit(best.value);
			setAmount(String(seconds / Number(best.value)));
		} else {
			setUnit("3600");
			setAmount("1");
		}
	}, [open, ttl]);

	async function go(action: () => Promise<string | null>) {
		setBusy(true);
		const failure = await action();
		setBusy(false);
		if (failure) setError(failure);
		else onClose();
	}

	return (
		<Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
			<DialogContent className="sm:max-w-md">
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						const seconds = Math.round(Number(amount) * Number(unit));
						if (!Number.isFinite(seconds) || seconds < 1) {
							setError("Enter a duration of at least one second.");
							return;
						}
						void go(() => onSet(seconds));
					}}
				>
					<DialogHeader>
						<DialogTitle>Expiry</DialogTitle>
						<DialogDescription>
							<span className="break-all font-mono text-foreground/85">{name}</span>{" "}
							{ttl >= 0 ? `expires in ${formatTtl(ttl)}.` : "never expires."} Redis deletes it when
							the time runs out (EXPIRE).
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2">
						<Label htmlFor={`${id}-amount`}>Expire in</Label>
						<div className="flex gap-2">
							<Input
								id={`${id}-amount`}
								type="number"
								inputMode="decimal"
								min={1}
								step="any"
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								className="w-28 font-mono tabular-nums"
								autoFocus
								aria-invalid={!!error}
								aria-describedby={error ? `${id}-error` : undefined}
							/>
							<Select value={unit} onValueChange={setUnit}>
								<SelectTrigger className="w-32" aria-label="Unit">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{UNITS.map((u) => (
										<SelectItem key={u.value} value={u.value}>
											{u.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<ErrorText id={`${id}-error`} error={error} />
					<DialogFooter className="sm:justify-between">
						{ttl >= 0 ? (
							<Button
								type="button"
								variant="ghost"
								onClick={() => void go(onPersist)}
								disabled={busy}
							>
								Remove expiry
							</Button>
						) : (
							<span />
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row">
							<Button type="button" variant="outline" onClick={onClose} disabled={busy}>
								Cancel
							</Button>
							<Button type="submit" disabled={busy}>
								{busy && (
									<Loader2
										className="animate-spin motion-reduce:animate-none"
										data-icon="inline-start"
									/>
								)}
								Set expiry
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/* ------------------------------------------------------------------ *
 * Rename
 * ------------------------------------------------------------------ */

export function RenameDialog({
	open,
	name,
	onClose,
	onRename,
}: {
	open: boolean;
	name: string;
	onClose: () => void;
	onRename: (next: string, overwrite: boolean) => Promise<string | null>;
}) {
	const [value, setValue] = useState(name);
	const [overwrite, setOverwrite] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const id = useId();

	useEffect(() => {
		if (!open) return;
		setValue(name);
		setOverwrite(false);
		setError(null);
		setBusy(false);
	}, [open, name]);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
			<DialogContent className="sm:max-w-md">
				<form
					className="grid gap-4"
					onSubmit={async (event) => {
						event.preventDefault();
						if (!value) {
							setError("Give the key a name.");
							return;
						}
						setBusy(true);
						const failure = await onRename(value, overwrite);
						setBusy(false);
						if (failure) setError(failure);
						else onClose();
					}}
				>
					<DialogHeader>
						<DialogTitle>Rename key</DialogTitle>
						<DialogDescription>The value, type and expiry move with it.</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2">
						<Label htmlFor={`${id}-name`}>New name</Label>
						<Input
							id={`${id}-name`}
							value={value}
							onChange={(e) => setValue(e.target.value)}
							className="font-mono text-[0.8125rem]"
							spellCheck={false}
							autoComplete="off"
							autoFocus
							aria-invalid={!!error}
							aria-describedby={error ? `${id}-error` : undefined}
						/>
					</div>
					<label className="flex items-start gap-2.5 text-sm">
						<input
							type="checkbox"
							checked={overwrite}
							onChange={(e) => setOverwrite(e.target.checked)}
							className="mt-0.5 size-4 accent-[var(--destructive)]"
						/>
						<span>
							Replace a key that already has this name
							<span className="block text-muted-foreground text-xs">
								Off: the rename is refused if the name is taken (RENAMENX).
							</span>
						</span>
					</label>
					<ErrorText id={`${id}-error`} error={error} />
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose} disabled={busy}>
							Cancel
						</Button>
						<Button type="submit" variant={overwrite ? "destructive" : "default"} disabled={busy}>
							{busy && (
								<Loader2
									className="animate-spin motion-reduce:animate-none"
									data-icon="inline-start"
								/>
							)}
							Rename
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/* ------------------------------------------------------------------ *
 * Delete one key
 * ------------------------------------------------------------------ */

export function DeleteKeyDialog({
	target,
	onClose,
	onDelete,
}: {
	target: { name: string; type: string; detail: string } | null;
	onClose: () => void;
	onDelete: () => Promise<string | null>;
}) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (target) {
			setError(null);
			setBusy(false);
		}
	}, [target]);

	return (
		<AlertDialog open={!!target} onOpenChange={(open) => !open && !busy && onClose()}>
			<AlertDialogContent className="sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>Delete this key?</AlertDialogTitle>
					<AlertDialogDescription>
						It is removed for good (UNLINK). There is no undo.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{target && (
					<div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
						<TypeBadge type={target.type} className="mt-px" />
						<div className="min-w-0">
							<p className="break-all font-mono text-[0.8125rem]">{target.name}</p>
							<p className="mt-0.5 text-muted-foreground text-xs">
								{typeLabel(target.type)} · {target.detail}
							</p>
						</div>
					</div>
				)}
				<ErrorText id="delete-key-error" error={error} />
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={busy}
						onClick={async (event) => {
							event.preventDefault();
							setBusy(true);
							const failure = await onDelete();
							setBusy(false);
							if (failure) setError(failure);
							else onClose();
						}}
					>
						{busy && (
							<Loader2
								className="animate-spin motion-reduce:animate-none"
								data-icon="inline-start"
							/>
						)}
						Delete key
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/* ------------------------------------------------------------------ *
 * Delete by pattern
 * ------------------------------------------------------------------ */

export function BulkDeleteDialog({
	open,
	initialPattern,
	onClose,
	onPreview,
	onDelete,
}: {
	open: boolean;
	initialPattern: string;
	onClose: () => void;
	onPreview: (
		pattern: string,
	) => Promise<{ count: number; sample: string[]; complete: boolean } | string>;
	onDelete: (pattern: string) => Promise<{ deleted: number; complete: boolean } | string>;
}) {
	const [pattern, setPattern] = useState(initialPattern);
	const [preview, setPreview] = useState<{
		pattern: string;
		count: number;
		sample: string[];
		complete: boolean;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"preview" | "delete" | null>(null);
	const [result, setResult] = useState<{ deleted: number; complete: boolean } | null>(null);
	const id = useId();

	useEffect(() => {
		if (!open) return;
		setPattern(initialPattern === "*" ? "" : initialPattern);
		setPreview(null);
		setError(null);
		setBusy(null);
		setResult(null);
	}, [open, initialPattern]);

	const stale = preview && preview.pattern !== pattern.trim();
	const everything = pattern.trim() === "*";

	return (
		<Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<form
					className="grid gap-4"
					onSubmit={async (event) => {
						event.preventDefault();
						const p = pattern.trim();
						if (!p) {
							setError("Enter a pattern, such as cache:*");
							return;
						}
						setBusy("preview");
						setError(null);
						setResult(null);
						const outcome = await onPreview(p);
						setBusy(null);
						if (typeof outcome === "string") setError(outcome);
						else setPreview({ pattern: p, ...outcome });
					}}
				>
					<DialogHeader>
						<DialogTitle>Delete keys by pattern</DialogTitle>
						<DialogDescription>
							Matches with SCAN, deletes with UNLINK in batches. Preview the count first.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2">
						<Label htmlFor={`${id}-pattern`}>Pattern</Label>
						<div className="flex gap-2">
							<Input
								id={`${id}-pattern`}
								value={pattern}
								onChange={(e) => setPattern(e.target.value)}
								placeholder="cache:*"
								className="font-mono text-[0.8125rem]"
								spellCheck={false}
								autoComplete="off"
								autoFocus
							/>
							<Button type="submit" variant="outline" disabled={!!busy}>
								{busy === "preview" && (
									<Loader2
										className="animate-spin motion-reduce:animate-none"
										data-icon="inline-start"
									/>
								)}
								Preview
							</Button>
						</div>
						<p className="text-muted-foreground text-xs">
							Glob syntax: <code>*</code> any characters, <code>?</code> one, <code>[abc]</code> a
							set.
						</p>
					</div>

					{preview && !stale && !result && (
						<div
							className={cn(
								"rounded-lg border px-3 py-2.5 text-sm",
								preview.count > 0
									? "border-destructive/30 bg-destructive/[0.05]"
									: "border-border bg-muted/40",
							)}
						>
							<p className="font-medium">
								{preview.count === 0
									? "No keys match."
									: `${preview.complete ? "" : "At least "}${preview.count.toLocaleString()} ${preview.count === 1 ? "key matches" : "keys match"}`}
							</p>
							{preview.sample.length > 0 && (
								<ul className="mt-2 max-h-36 space-y-0.5 overflow-y-auto font-mono text-muted-foreground text-xs">
									{preview.sample.map((name) => (
										<li key={name} className="truncate">
											{name}
										</li>
									))}
									{preview.count > preview.sample.length && <li>…</li>}
								</ul>
							)}
							{!preview.complete && (
								<p className="mt-2 text-muted-foreground text-xs">
									The count stopped early on a large keyspace; the delete keeps going until it is
									done or runs out of time.
								</p>
							)}
						</div>
					)}
					{everything && (
						<p className="flex items-start gap-2 text-warning text-xs">
							<TriangleAlert className="mt-px size-3.5 shrink-0" />
							This matches every key. Flush database does the same in one step.
						</p>
					)}
					{result && (
						<p
							role="status"
							className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm"
						>
							Deleted {result.deleted.toLocaleString()} {result.deleted === 1 ? "key" : "keys"}.
							{!result.complete &&
								" Some remain: the delete ran out of time. Run it again to continue."}
						</p>
					)}
					<ErrorText id={`${id}-error`} error={error} />
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose} disabled={!!busy}>
							{result ? "Close" : "Cancel"}
						</Button>
						{!result && (
							<Button
								type="button"
								variant="destructive"
								disabled={!preview || !!stale || preview.count === 0 || !!busy}
								onClick={async () => {
									if (!preview) return;
									setBusy("delete");
									setError(null);
									const outcome = await onDelete(preview.pattern);
									setBusy(null);
									if (typeof outcome === "string") setError(outcome);
									else setResult(outcome);
								}}
							>
								{busy === "delete" && (
									<Loader2
										className="animate-spin motion-reduce:animate-none"
										data-icon="inline-start"
									/>
								)}
								{preview && !stale && preview.count > 0
									? `Delete ${preview.complete ? "" : "at least "}${preview.count.toLocaleString()} ${preview.count === 1 ? "key" : "keys"}`
									: "Delete"}
							</Button>
						)}
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/* ------------------------------------------------------------------ *
 * FLUSHDB
 * ------------------------------------------------------------------ */

export function FlushDialog({
	open,
	databaseName,
	keys,
	onClose,
	onFlush,
}: {
	open: boolean;
	databaseName: string;
	keys: number | null;
	onClose: () => void;
	onFlush: (typed: string) => Promise<string | null>;
}) {
	const [typed, setTyped] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const id = useId();
	useEffect(() => {
		if (open) {
			setTyped("");
			setError(null);
			setBusy(false);
		}
	}, [open]);

	return (
		<AlertDialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
			<AlertDialogContent className="sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<TriangleAlert className="size-4 text-destructive" />
						Flush the whole database?
					</AlertDialogTitle>
					<AlertDialogDescription>
						FLUSHDB deletes {keys !== null ? `all ${keys.toLocaleString()} keys` : "every key"} in
						this database. There is no undo.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="grid gap-2">
					<Label htmlFor={`${id}-confirm`}>
						Type <span className="font-mono font-medium">{databaseName}</span> to confirm
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
				<ErrorText id={`${id}-error`} error={error} />
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={typed !== databaseName || busy}
						onClick={async (event) => {
							event.preventDefault();
							setBusy(true);
							const failure = await onFlush(typed);
							setBusy(false);
							if (failure) setError(failure);
							else onClose();
						}}
					>
						{busy && (
							<Loader2
								className="animate-spin motion-reduce:animate-none"
								data-icon="inline-start"
							/>
						)}
						Flush database
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

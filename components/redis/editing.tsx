"use client";

import { Clock, Pencil, Plus, TextCursorInput, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { editKeyAction } from "@/app/(dashboard)/databases/[id]/browser/actions";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import type { EditOp } from "@/lib/redis/edit";
import { keyLabel } from "@/lib/redis/keys";
import type { KeyDetails } from "@/lib/redis/types";
import {
	DeleteKeyDialog,
	type FieldSpec,
	FormDialog,
	type FormState,
	RenameDialog,
	TtlDialog,
} from "./edit-dialogs";
import type { RowAction } from "./value-view";

/**
 * Editing for the selected key: header actions (add, expiry, rename, delete), the row
 * action of the value grid (edit or remove one element), and the string editor. Every
 * change goes through `editKeyAction`, which writes as the tenant and names exactly what
 * it changes; the browser then reloads what it shows.
 */

export type EditEvent =
	| { kind: "updated"; key: string }
	| { kind: "deleted"; key: string }
	| { kind: "renamed"; from: string; to: string }
	| { kind: "created"; key: string; type: string; ttl: number };

const isScore = (value: string) =>
	/^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|[+-]?inf)$/i.test(value.trim())
		? null
		: "Scores are numbers, or inf / -inf.";

export function useEditor(databaseId: string, onEvent: (event: EditEvent) => void) {
	/** Runs one change; resolves to an error message, or null after a success toast. */
	return useCallback(
		async (
			op: EditOp,
			event?: EditEvent | ((key: string | null) => EditEvent),
		): Promise<string | null> => {
			try {
				const result = await editKeyAction(databaseId, op);
				if (!result.ok) return result.friendly ?? result.error;
				toast.success(result.message);
				const next = typeof event === "function" ? event(result.key) : event;
				if (next) onEvent(next);
				return null;
			} catch {
				return "Could not reach the server. Check your connection and try again.";
			}
		},
		[databaseId, onEvent],
	);
}

export function useKeyEditing({
	databaseId,
	details,
	onEvent,
}: {
	databaseId: string;
	details: KeyDetails | null;
	onEvent: (event: EditEvent) => void;
}): {
	actions: ReactNode;
	rowAction?: RowAction;
	valueToolbar?: ReactNode;
	/** For JSON documents: edit (or remove) the value at one path. */
	editJsonPath?: (path: string, value: unknown) => void;
	dialogs: ReactNode;
} {
	const edit = useEditor(databaseId, onEvent);
	const [form, setForm] = useState<FormState | null>(null);
	const [ttlOpen, setTtlOpen] = useState(false);
	const [renameOpen, setRenameOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const meta = details?.meta;
	const value = details?.value;
	const key = meta?.key ?? "";
	const updated: EditEvent = { kind: "updated", key };

	const field = (spec: Partial<FieldSpec> & Pick<FieldSpec, "name" | "label">): FieldSpec => ({
		kind: "input",
		initial: "",
		...spec,
	});
	const valueField = (initial = "", label = "Value") =>
		field({ name: "value", label, kind: "textarea", initial, placeholder: "Value" });
	const binaryHint = "Binary values cannot be edited here. Use the console, with \\xHH escapes.";

	/* ---------------- add ---------------- */

	let add: { label: string; open: () => void } | null = null;
	if (meta && value) {
		switch (value.kind) {
			case "list":
				add = {
					label: "Add element",
					open: () =>
						setForm({
							title: "Add an element",
							fields: [
								valueField(),
								field({
									name: "end",
									label: "Where",
									kind: "select",
									initial: "tail",
									options: [
										{ value: "tail", label: "At the tail (RPUSH)" },
										{ value: "head", label: "At the head (LPUSH)" },
									],
								}),
							],
							submitLabel: "Add",
							submit: (v) =>
								edit(
									{ op: "list.push", key, value: v.value, end: v.end === "head" ? "head" : "tail" },
									updated,
								),
						}),
				};
				break;
			case "hash":
				add = {
					label: "Add field",
					open: () =>
						setForm({
							title: "Add a field",
							fields: [
								field({
									name: "field",
									label: "Field",
									placeholder: "name",
									validate: (f) => (f ? null : "Name the field."),
								}),
								valueField(),
							],
							submitLabel: "Add field",
							submit: (v) => edit({ op: "hash.set", key, field: v.field, value: v.value }, updated),
						}),
				};
				break;
			case "set":
				add = {
					label: "Add member",
					open: () =>
						setForm({
							title: "Add a member",
							fields: [valueField("", "Member")],
							submitLabel: "Add member",
							submit: (v) => edit({ op: "set.add", key, member: v.value }, updated),
						}),
				};
				break;
			case "zset":
				add = {
					label: "Add member",
					open: () =>
						setForm({
							title: "Add a member",
							description: "If the member exists, its score is updated (ZADD).",
							fields: [
								field({ name: "member", label: "Member", placeholder: "player:1" }),
								field({ name: "score", label: "Score", initial: "0", validate: isScore }),
							],
							submitLabel: "Save",
							submit: (v) =>
								edit({ op: "zset.add", key, member: v.member, score: v.score.trim() }, updated),
						}),
				};
				break;
			case "stream":
				add = {
					label: "Add entry",
					open: () =>
						setForm({
							title: "Add an entry",
							description: "Appended with XADD.",
							fields: [
								field({
									name: "fields",
									label: "Fields, as a JSON object",
									kind: "textarea",
									placeholder: '{\n  "status": "paid",\n  "total": "42.00"\n}',
								}),
								field({
									name: "id",
									label: "Id",
									initial: "*",
									hint: "* lets Redis pick the next id.",
								}),
							],
							submitLabel: "Add entry",
							submit: (v) => {
								let pairs: [string, string][];
								try {
									const parsed = JSON.parse(v.fields) as Record<string, unknown>;
									if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
										throw new Error();
									pairs = Object.entries(parsed).map(([k, x]) => [
										k,
										typeof x === "string" ? x : JSON.stringify(x),
									]);
								} catch {
									return Promise.resolve(
										'Write the fields as a JSON object, like {"status": "paid"}.',
									);
								}
								if (pairs.length === 0) return Promise.resolve("Add at least one field.");
								return edit(
									{ op: "stream.add", key, id: v.id.trim() || "*", fields: pairs },
									updated,
								);
							},
						}),
				};
				break;
		}
	}

	/* ---------------- row action: edit or remove one element ---------------- */

	let rowAction: RowAction | undefined;
	if (value && meta) {
		if (value.kind === "list") {
			rowAction = {
				label: "Edit element",
				run: (i) => {
					const item = value.items[i];
					if (!item) return;
					const editable = !item.value.binary && !item.value.truncated && !!item.value.ref;
					setForm({
						title: `Element ${item.index}`,
						description: editable ? undefined : binaryHint,
						fields: editable ? [valueField(item.value.text)] : [],
						submitLabel: editable ? "Save" : "Close",
						submit: editable
							? (v) =>
									edit(
										{
											op: "list.set",
											key,
											index: item.index,
											expect: item.value.ref,
											value: v.value,
										},
										updated,
									)
							: async () => null,
						remove: item.value.ref
							? {
									label: "Remove element",
									run: () =>
										edit(
											{ op: "list.remove", key, index: item.index, expect: item.value.ref },
											updated,
										),
								}
							: undefined,
					});
				},
			};
		} else if (value.kind === "hash") {
			rowAction = {
				label: "Edit field",
				run: (i) => {
					const entry = value.entries[i];
					if (!entry) return;
					const editable =
						!entry.field.binary &&
						!entry.value.binary &&
						!entry.value.truncated &&
						!!entry.field.ref;
					setForm({
						title: "Edit field",
						description: editable ? "Renaming the field moves its value." : binaryHint,
						fields: editable
							? [
									field({
										name: "field",
										label: "Field",
										initial: entry.field.text,
										validate: (f) => (f ? null : "Name the field."),
									}),
									valueField(entry.value.text),
								]
							: [],
						submitLabel: editable ? "Save" : "Close",
						submit: editable
							? (v) =>
									edit(
										{ op: "hash.set", key, field: v.field, value: v.value, from: entry.field.ref },
										updated,
									)
							: async () => null,
						remove: entry.field.ref
							? {
									label: "Delete field",
									run: () => edit({ op: "hash.delete", key, field: entry.field.ref }, updated),
								}
							: undefined,
					});
				},
			};
		} else if (value.kind === "set") {
			rowAction = {
				label: "Edit member",
				run: (i) => {
					const member = value.members[i];
					if (!member) return;
					const editable = !member.binary && !member.truncated && !!member.ref;
					setForm({
						title: "Edit member",
						description: editable ? "Saving replaces the member (SREM, then SADD)." : binaryHint,
						fields: editable ? [valueField(member.text, "Member")] : [],
						submitLabel: editable ? "Save" : "Close",
						submit: editable
							? (v) => edit({ op: "set.replace", key, member: member.ref, next: v.value }, updated)
							: async () => null,
						remove: member.ref
							? {
									label: "Remove member",
									run: () => edit({ op: "set.remove", key, member: member.ref }, updated),
								}
							: undefined,
					});
				},
			};
		} else if (value.kind === "zset") {
			rowAction = {
				label: "Edit member",
				run: (i) => {
					const item = value.members[i];
					if (!item) return;
					const editable = !item.member.binary && !item.member.truncated && !!item.member.ref;
					setForm({
						title: "Edit member",
						description: editable ? undefined : binaryHint,
						fields: editable
							? [
									field({ name: "member", label: "Member", initial: item.member.text }),
									field({ name: "score", label: "Score", initial: item.score, validate: isScore }),
								]
							: [],
						submitLabel: editable ? "Save" : "Close",
						submit: editable
							? (v) =>
									edit(
										{
											op: "zset.replace",
											key,
											member: item.member.ref,
											next: v.member,
											score: v.score.trim(),
										},
										updated,
									)
							: async () => null,
						remove: item.member.ref
							? {
									label: "Remove member",
									run: () => edit({ op: "zset.remove", key, member: item.member.ref }, updated),
								}
							: undefined,
					});
				},
			};
		}
	}

	if (value?.kind === "stream") {
		rowAction = {
			label: "View entry",
			run: (i) => {
				const entry = value.entries[i];
				if (!entry) return;
				setForm({
					title: `Entry ${entry.id}`,
					description: (
						<pre className="mt-2 max-h-[40dvh] overflow-auto rounded-md border border-border bg-[var(--code-background)] px-3 py-2 font-mono text-foreground text-xs leading-relaxed">
							{JSON.stringify(Object.fromEntries(entry.fields), null, 2)}
						</pre>
					),
					fields: [],
					submitLabel: "Close",
					submit: async () => null,
					remove: {
						label: "Delete entry",
						run: () => edit({ op: "stream.delete", key, id: entry.id }, updated),
					},
				});
			},
		};
	}

	let editJsonPath: ((path: string, value: unknown) => void) | undefined;
	if (value?.kind === "json" && value.json !== null) {
		editJsonPath = (path, current) =>
			setForm({
				title: path === "$" ? "Edit document" : `Edit ${path}`,
				description: "Any JSON value. Saved with JSON.SET at this path.",
				fields: [valueField(JSON.stringify(current, null, 2), "JSON")].map((f) => ({
					...f,
					validate: (text: string) => {
						try {
							JSON.parse(text);
							return null;
						} catch (error) {
							return `Not valid JSON: ${(error as Error).message}`;
						}
					},
				})),
				submitLabel: "Save",
				submit: (v) => edit({ op: "json.set", key, path, json: v.value }, updated),
				remove:
					path === "$"
						? undefined
						: { label: "Delete value", run: () => edit({ op: "json.delete", key, path }, updated) },
			});
	}

	/* ---------------- strings ---------------- */

	let valueToolbar: ReactNode;
	if (value?.kind === "json" && value.json !== null && editJsonPath) {
		const document = value.json;
		const open = editJsonPath;
		valueToolbar = (
			<Button variant="ghost" size="xs" onClick={() => open("$", JSON.parse(document))}>
				<Pencil data-icon="inline-start" />
				Edit document
			</Button>
		);
	}
	if (value?.kind === "string") {
		const editable = !value.value.binary && !value.value.truncated;
		valueToolbar = (
			<Button
				variant="ghost"
				size="xs"
				disabled={!editable}
				title={
					editable
						? "Edit value"
						: value.value.binary
							? binaryHint
							: "Too large to edit here; use SET in the console"
				}
				onClick={() =>
					setForm({
						title: "Edit value",
						description: "Saved with SET ... XX KEEPTTL: the expiry is kept.",
						fields: [valueField(value.value.text)],
						submitLabel: "Save",
						submit: (v) => edit({ op: "string.set", key, value: v.value }, updated),
					})
				}
			>
				<Pencil data-icon="inline-start" />
				Edit
			</Button>
		);
	}

	/* ---------------- header ---------------- */

	const exists = !!meta && meta.type !== "none";
	const actions = exists ? (
		<>
			{add && (
				<Button variant="outline" size="xs" onClick={add.open}>
					<Plus data-icon="inline-start" />
					{add.label}
				</Button>
			)}
			<Button variant="outline" size="xs" onClick={() => setTtlOpen(true)}>
				<Clock data-icon="inline-start" />
				Expiry
			</Button>
			<Button variant="outline" size="xs" onClick={() => setRenameOpen(true)}>
				<TextCursorInput data-icon="inline-start" />
				Rename
			</Button>
			<Button
				variant="outline"
				size="xs"
				className="text-destructive hover:bg-destructive/10 hover:text-destructive"
				onClick={() => setDeleting(true)}
			>
				<Trash2 data-icon="inline-start" />
				Delete
			</Button>
		</>
	) : null;

	const dialogs = (
		<>
			<FormDialog state={form} onClose={() => setForm(null)} />
			{meta && (
				<>
					<TtlDialog
						open={ttlOpen}
						name={keyLabel(key)}
						ttl={meta.ttl}
						onClose={() => setTtlOpen(false)}
						onSet={(seconds) => edit({ op: "ttl.set", key, seconds }, updated)}
						onPersist={() => edit({ op: "ttl.persist", key }, updated)}
					/>
					<RenameDialog
						open={renameOpen}
						name={keyLabel(key)}
						onClose={() => setRenameOpen(false)}
						onRename={(name, overwrite) =>
							edit({ op: "rename", key, name, overwrite }, (to) => ({
								kind: "renamed",
								from: key,
								to: to ?? key,
							}))
						}
					/>
					<DeleteKeyDialog
						target={
							deleting
								? {
										name: keyLabel(key),
										type: meta.type,
										detail: [
											meta.length !== null
												? meta.type === "string"
													? formatBytes(meta.length)
													: `${meta.length.toLocaleString()} elements`
												: null,
											meta.memory !== null ? `${formatBytes(meta.memory)} in memory` : null,
										]
											.filter(Boolean)
											.join(" · "),
									}
								: null
						}
						onClose={() => setDeleting(false)}
						onDelete={() => edit({ op: "delete", key }, { kind: "deleted", key })}
					/>
				</>
			)}
		</>
	);

	return { actions, rowAction, valueToolbar, editJsonPath, dialogs };
}

"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
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
import { typeLabel } from "@/lib/redis/keys";
import { TypeBadge } from "./type-badge";

/**
 * Create a key of any type the browser renders. The value field changes with the type,
 * and every format is plain text: one element per line, `score member` per line for a
 * sorted set, a JSON object for hash fields and stream entries.
 */

type NewType = "string" | "list" | "hash" | "set" | "zset" | "stream" | "json";

export type NewKeyValue =
	| { type: "string"; value: string }
	| { type: "list"; items: string[] }
	| { type: "hash"; fields: [string, string][] }
	| { type: "set"; members: string[] }
	| { type: "zset"; members: [string, string][] }
	| { type: "stream"; fields: [string, string][] }
	| { type: "json"; json: string };

const VALUE: Record<NewType, { label: string; placeholder: string; hint?: string }> = {
	string: { label: "Value", placeholder: "Hello" },
	list: {
		label: "Elements, one per line",
		placeholder: "first\nsecond\nthird",
		hint: "Pushed in order (RPUSH).",
	},
	hash: {
		label: "Fields, as a JSON object",
		placeholder: '{\n  "name": "Ada",\n  "plan": "pro"\n}',
	},
	set: { label: "Members, one per line", placeholder: "redis\npostgres" },
	zset: {
		label: "Members, one per line as score member",
		placeholder: "100 player:1\n42.5 player:2",
	},
	stream: {
		label: "First entry's fields, as a JSON object",
		placeholder: '{\n  "event": "signup",\n  "user": "42"\n}',
		hint: "Added with an id Redis picks (XADD *).",
	},
	json: { label: "JSON document", placeholder: '{\n  "name": "shop",\n  "tags": ["a", "b"]\n}' },
};

function lines(text: string): string[] {
	return text.split(/\r?\n/).filter((line) => line.length > 0);
}

function objectPairs(text: string): [string, string][] {
	const parsed: unknown = JSON.parse(text);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error('Write the fields as a JSON object, like {"name": "Ada"}.');
	}
	const pairs = Object.entries(parsed as Record<string, unknown>).map(
		([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as [string, string],
	);
	if (pairs.length === 0) throw new Error("Add at least one field.");
	return pairs;
}

/** Parse the value box for a type, or explain what is wrong with it. */
export function parseNewValue(type: NewType, text: string): NewKeyValue | string {
	try {
		switch (type) {
			case "string":
				return { type, value: text };
			case "list": {
				const items = lines(text);
				return items.length ? { type, items } : "Add at least one element.";
			}
			case "set": {
				const members = lines(text);
				return members.length ? { type, members } : "Add at least one member.";
			}
			case "zset": {
				const members: [string, string][] = [];
				for (const line of lines(text)) {
					const match = /^\s*(\S+)\s+(.+)$/.exec(line);
					if (!match || (!Number.isFinite(Number(match[1])) && !/^[+-]?inf$/i.test(match[1]))) {
						return `Each line is a score, a space, then the member: "${line}" is not.`;
					}
					members.push([match[1], match[2]]);
				}
				return members.length ? { type, members } : "Add at least one member.";
			}
			case "hash":
			case "stream":
				return { type, fields: objectPairs(text) };
			case "json":
				JSON.parse(text);
				return { type, json: text };
		}
	} catch (error) {
		return error instanceof SyntaxError
			? `Not valid JSON: ${error.message}`
			: (error as Error).message;
	}
}

export function NewKeyDialog({
	open,
	jsonAvailable,
	initialPrefix,
	onClose,
	onCreate,
}: {
	open: boolean;
	jsonAvailable: boolean;
	initialPrefix: string;
	onClose: () => void;
	onCreate: (input: { key: string; ttl?: number; value: NewKeyValue }) => Promise<string | null>;
}) {
	const [type, setType] = useState<NewType>("string");
	const [name, setName] = useState("");
	const [ttl, setTtl] = useState("");
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const id = useId();

	useEffect(() => {
		if (!open) return;
		setName(initialPrefix);
		setTtl("");
		setValue("");
		setError(null);
		setBusy(false);
	}, [open, initialPrefix]);

	const types: NewType[] = [
		"string",
		"list",
		"hash",
		"set",
		"zset",
		"stream",
		...(jsonAvailable ? (["json"] as const) : []),
	];
	const spec = VALUE[type];

	return (
		<Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<form
					className="grid gap-4"
					onSubmit={async (event) => {
						event.preventDefault();
						if (!name) {
							setError("Give the key a name.");
							return;
						}
						const parsed = parseNewValue(type, value);
						if (typeof parsed === "string") {
							setError(parsed);
							return;
						}
						const seconds = ttl.trim() ? Math.round(Number(ttl)) : undefined;
						if (seconds !== undefined && (!Number.isFinite(seconds) || seconds < 1)) {
							setError("Expiry is a whole number of seconds, or empty for none.");
							return;
						}
						setBusy(true);
						const failure = await onCreate({ key: name, ttl: seconds, value: parsed });
						setBusy(false);
						if (failure) setError(failure);
						else onClose();
					}}
				>
					<DialogHeader>
						<DialogTitle>New key</DialogTitle>
						<DialogDescription>Refused if a key with this name already exists.</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
						<div className="grid gap-2">
							<Label htmlFor={`${id}-type`}>Type</Label>
							<Select value={type} onValueChange={(v) => setType(v as NewType)}>
								<SelectTrigger id={`${id}-type`} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{types.map((t) => {
										const redisType = t === "json" ? "ReJSON-RL" : t;
										return (
											<SelectItem key={t} value={t}>
												<TypeBadge type={redisType} className="w-10" />
												{typeLabel(redisType)}
											</SelectItem>
										);
									})}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label htmlFor={`${id}-name`}>Name</Label>
							<Input
								id={`${id}-name`}
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="user:42"
								className="font-mono text-[0.8125rem]"
								spellCheck={false}
								autoComplete="off"
								autoFocus
							/>
						</div>
					</div>
					<div className="grid gap-2">
						<Label htmlFor={`${id}-value`}>{spec.label}</Label>
						<Textarea
							id={`${id}-value`}
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder={spec.placeholder}
							spellCheck={false}
							className="max-h-[36dvh] min-h-28 resize-y font-mono text-[0.8125rem]"
							aria-invalid={!!error}
							aria-describedby={error ? `${id}-error` : undefined}
						/>
						{spec.hint && <p className="text-muted-foreground text-xs">{spec.hint}</p>}
					</div>
					<div className="grid gap-2">
						<Label htmlFor={`${id}-ttl`}>Expire after (seconds, optional)</Label>
						<Input
							id={`${id}-ttl`}
							type="number"
							inputMode="numeric"
							min={1}
							value={ttl}
							onChange={(e) => setTtl(e.target.value)}
							placeholder="No expiry"
							className="w-40 font-mono tabular-nums"
						/>
					</div>
					{error && (
						<p id={`${id}-error`} role="alert" className="text-destructive text-xs leading-relaxed">
							{error}
						</p>
					)}
					<DialogFooter>
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
							Create key
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

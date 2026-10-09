"use client";

import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	bsonTypeOf,
	type EJsonValue,
	isObject,
	shellTypeLiteral,
	toShell,
} from "@/lib/mongo/literal";
import { cn } from "@/lib/utils";

/**
 * Extended JSON rendered the way a shell user reads it: types as their constructors
 * (`ObjectId("…")`, `ISODate("…")`, `NumberLong("…")`), documents and arrays as a
 * collapsible tree. Type wrappers are leaves, never expanded into `{ $oid: … }`.
 */

const CHILD_LIMIT = 200;

export function isContainer(
	value: EJsonValue,
): value is EJsonValue[] | { [k: string]: EJsonValue } {
	if (Array.isArray(value)) return true;
	return isObject(value) && shellTypeLiteral(value) === null;
}

/** One scalar or type wrapper, coloured by kind. */
export function TypedValue({ value, className }: { value: EJsonValue; className?: string }) {
	if (value === null)
		return <span className={cn("text-muted-foreground italic", className)}>null</span>;
	if (typeof value === "string") {
		return (
			<span className={cn("min-w-0 truncate text-brand-text", className)}>
				{JSON.stringify(value)}
			</span>
		);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return (
			<span className={cn("text-[var(--type-string)] tabular-nums", className)}>
				{String(value)}
			</span>
		);
	}
	if (isObject(value)) {
		const literal = shellTypeLiteral(value);
		if (literal) {
			const open = literal.indexOf("(");
			if (open > 0 && literal.endsWith(")")) {
				return (
					<span className={cn("min-w-0 truncate", className)}>
						<span className="text-muted-foreground">{literal.slice(0, open + 1)}</span>
						<span className="text-[var(--type-string)]">{literal.slice(open + 1, -1)}</span>
						<span className="text-muted-foreground">)</span>
					</span>
				);
			}
			return (
				<span className={cn("min-w-0 truncate text-[var(--type-string)]", className)}>
					{literal}
				</span>
			);
		}
	}
	return <span className={cn("min-w-0 truncate", className)}>{toShell(value, 0)}</span>;
}

/** A single-line preview for a table cell. */
export function cellText(value: EJsonValue | undefined, max = 160, compact = false): string {
	if (value === undefined) return "";
	if (value === null) return "null";
	if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	// In a table column the header already names the type: show the id or the date itself.
	if (compact && isObject(value)) {
		if (typeof value.$oid === "string") return value.$oid;
		if (typeof value.$date === "string") return value.$date;
		if (typeof value.$numberDecimal === "string") return value.$numberDecimal;
		if (typeof value.$numberLong === "string") return value.$numberLong;
	}
	const text = toShell(value, 0);
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function DocumentTree({
	doc,
	label = "document",
	openDepth = 1,
	actions,
}: {
	doc: EJsonValue;
	label?: string;
	openDepth?: number;
	/** Shown at the end of the root row, e.g. edit and delete buttons. */
	actions?: ReactNode;
}) {
	return (
		<div role="tree" aria-label={label} className="font-mono text-[0.8125rem]" translate="no">
			<TreeNode name={null} value={doc} depth={0} openDepth={openDepth} actions={actions} />
		</div>
	);
}

function TreeNode({
	name,
	value,
	depth,
	openDepth,
	index,
	actions,
}: {
	name: string | null;
	value: EJsonValue;
	depth: number;
	openDepth: number;
	index?: boolean;
	actions?: ReactNode;
}) {
	const container = isContainer(value);
	const [open, setOpen] = useState(depth < openDepth);
	const [all, setAll] = useState(false);
	const entries: [string | number, EJsonValue][] = container
		? Array.isArray(value)
			? value.map((v, i) => [i, v])
			: Object.entries(value)
		: [];
	const shown = all ? entries : entries.slice(0, CHILD_LIMIT);
	const summary = Array.isArray(value)
		? `Array (${entries.length})`
		: `{ ${entries.length} field${entries.length === 1 ? "" : "s"} }`;

	return (
		<div role="treeitem" aria-expanded={container ? open : undefined} aria-selected={false}>
			<div
				className="group/node flex min-h-7 items-center gap-1.5 pr-2 hover:bg-accent/40"
				style={{ paddingLeft: 8 + depth * 16 }}
			>
				{container ? (
					<button
						type="button"
						onClick={() => setOpen((o) => !o)}
						aria-label={open ? `Collapse ${name ?? "document"}` : `Expand ${name ?? "document"}`}
						className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
					>
						<ChevronRight
							className={cn(
								"size-3.5 transition-transform motion-reduce:transition-none",
								open && "rotate-90",
							)}
						/>
					</button>
				) : (
					<span className="size-4 shrink-0" />
				)}
				{name !== null && (
					<>
						<span className={cn("shrink-0", index ? "text-muted-foreground" : "text-foreground")}>
							{name}
						</span>
						<span className="shrink-0 text-muted-foreground">:</span>
					</>
				)}
				{container ? (
					<button
						type="button"
						onClick={() => setOpen((o) => !o)}
						tabIndex={-1}
						className="min-w-0 truncate text-left text-muted-foreground text-xs"
					>
						{open || depth === 0 ? summary : cellText(value, 120)}
					</button>
				) : (
					<TypedValue value={value} />
				)}
				{!container && name !== null && (
					<span className="ml-auto hidden shrink-0 pl-3 font-sans text-[0.6875rem] text-muted-foreground/80 group-hover/node:inline">
						{bsonTypeOf(value)}
					</span>
				)}
				{actions && <span className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</span>}
			</div>
			{container && open && (
				<div role="group">
					{shown.map(([key, child]) => (
						<TreeNode
							key={String(key)}
							name={String(key)}
							index={typeof key === "number"}
							value={child}
							depth={depth + 1}
							openDepth={openDepth}
						/>
					))}
					{entries.length > shown.length && (
						<button
							type="button"
							onClick={() => setAll(true)}
							className="my-1 rounded-sm font-sans text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
							style={{ marginLeft: 8 + (depth + 1) * 16 + 22 }}
						>
							Show {entries.length - shown.length} more
						</button>
					)}
				</div>
			)}
		</div>
	);
}

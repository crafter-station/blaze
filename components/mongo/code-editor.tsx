"use client";

import {
	acceptCompletion,
	autocompletion,
	type CompletionContext,
	type CompletionResult,
	completionStatus,
	startCompletion,
} from "@codemirror/autocomplete";
import { insertNewlineAndIndent } from "@codemirror/commands";
import {
	bracketMatching,
	HighlightStyle,
	StreamLanguage,
	syntaxHighlighting,
} from "@codemirror/language";
import { type Diagnostic, linter } from "@codemirror/lint";
import { Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { editorTheme } from "@/components/console-shell/editor-theme";
import { complete, type CompletionContext as MongoCompletionContext } from "@/lib/mongo/completion";
import { LiteralParseError, parseLiteral } from "@/lib/mongo/literal";
import { parseShell } from "@/lib/mongo/shell";
import { cn } from "@/lib/utils";

/**
 * CodeMirror for Mongo: documents and filters (Extended JSON in shell syntax) and shell
 * commands. Highlighting is a small stream tokenizer; errors come from the same parser the
 * server uses, underlined where it stopped, so what the editor accepts is exactly what
 * will run.
 */

const CONSTRUCTORS =
	/^(ObjectId|ObjectID|ISODate|Date|NumberLong|NumberInt|NumberDecimal|NumberDouble|Decimal128|Long|Int32|Double|Timestamp|BinData|HexData|UUID|RegExp|MinKey|MaxKey)\b/;

interface TokState {
	/** Inside a block comment that started on an earlier line. */
	comment: boolean;
}

const mongoLanguage = StreamLanguage.define<TokState>({
	name: "mongosh",
	startState: () => ({ comment: false }),
	token(stream, state) {
		if (state.comment) {
			if (stream.skipTo("*/")) {
				stream.pos += 2;
				state.comment = false;
			} else stream.skipToEnd();
			return "comment";
		}
		if (stream.eatSpace()) return null;
		if (stream.match("//")) {
			stream.skipToEnd();
			return "comment";
		}
		if (stream.match("/*")) {
			state.comment = true;
			return "comment";
		}
		const ch = stream.peek();
		if (ch === '"' || ch === "'" || ch === "`") {
			stream.next();
			let escaped = false;
			while (!stream.eol()) {
				const c = stream.next();
				if (c === ch && !escaped) break;
				escaped = !escaped && c === "\\";
			}
			// A string followed by ":" is a key.
			return /^\s*:/.test(stream.string.slice(stream.pos)) ? "propertyName" : "string";
		}
		if (stream.match(/^-?(0x[0-9a-fA-F]+|\d[\d_]*(\.\d*)?([eE][+-]?\d+)?|\.\d+)/)) return "number";
		if (stream.match(/^\$[\w$]*/)) return "keyword";
		if (stream.match(CONSTRUCTORS)) return "typeName";
		if (stream.match(/^(true|false|null|undefined|NaN|Infinity)\b/)) return "atom";
		if (stream.match(/^(db|show|new)\b/)) return "variableName.special";
		if (stream.match(/^[A-Za-z_][\w]*/)) {
			const rest = stream.string.slice(stream.pos);
			if (/^\s*:/.test(rest)) return "propertyName";
			if (/^\s*\(/.test(rest)) return "function";
			return "variableName";
		}
		stream.next();
		return "punctuation";
	},
});

const highlight = HighlightStyle.define([
	{ tag: tags.string, color: "var(--brand-text)" },
	{ tag: [tags.number, tags.atom, tags.bool], color: "var(--type-string, var(--brand-text))" },
	{ tag: tags.keyword, color: "var(--foreground)", fontWeight: "600" },
	{ tag: tags.typeName, color: "var(--foreground)", fontWeight: "600" },
	{ tag: tags.propertyName, color: "color-mix(in oklab, var(--foreground) 82%, transparent)" },
	{
		tag: [tags.function(tags.variableName), tags.special(tags.variableName)],
		color: "var(--foreground)",
	},
	{ tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
	{ tag: tags.punctuation, color: "var(--muted-foreground)" },
]);

export type EditorMode = "document" | "shell";

function lintWith(mode: EditorMode, allowEmpty: boolean) {
	return linter(
		(view): Diagnostic[] => {
			const text = view.state.doc.toString();
			if (!text.trim()) return [];
			try {
				if (mode === "shell") parseShell(text);
				else parseLiteral(text);
				return [];
			} catch (error) {
				if (!(error instanceof LiteralParseError)) return [];
				if (allowEmpty && !text.trim()) return [];
				const from = Math.min(error.position, Math.max(0, text.length - 1));
				return [
					{ from, to: Math.min(text.length, from + 1), severity: "error", message: error.message },
				];
			}
		},
		{ delay: 250 },
	);
}

export interface CodeEditorApi {
	focus(): void;
	setDoc(text: string, cursorAtEnd?: boolean): void;
	getDoc(): string;
	insert(text: string): void;
}

export function CodeEditor({
	value,
	onChange,
	mode = "document",
	onSubmit,
	submitOnEnter = false,
	completion,
	placeholder,
	ariaLabel,
	singleLine = false,
	lineNumbers = false,
	minHeight,
	maxHeight,
	autoFocus,
	apiRef,
	onKeys,
	className,
	readOnly,
}: {
	value: string;
	onChange: (value: string) => void;
	mode?: EditorMode;
	/** Mod-Enter, and Enter too when `submitOnEnter`. */
	onSubmit?: () => void;
	/** Enter submits; Shift-Enter adds a line (the shell). */
	submitOnEnter?: boolean;
	/** Completion context for the shell; omitted, no completion. */
	completion?: RefObject<MongoCompletionContext>;
	placeholder?: string;
	ariaLabel: string;
	singleLine?: boolean;
	lineNumbers?: boolean;
	minHeight?: string;
	maxHeight?: string;
	autoFocus?: boolean;
	apiRef?: RefObject<CodeEditorApi | null>;
	/** Extra key handlers, checked first: return true to consume. */
	onKeys?: RefObject<Record<string, (view: EditorView) => boolean>>;
	className?: string;
	readOnly?: boolean;
}) {
	const viewRef = useRef<EditorView | null>(null);
	const submit = useRef(onSubmit);
	submit.current = onSubmit;

	useEffect(() => {
		if (!apiRef) return;
		apiRef.current = {
			focus: () => viewRef.current?.focus(),
			getDoc: () => viewRef.current?.state.doc.toString() ?? "",
			setDoc: (text, cursorAtEnd = true) => {
				const view = viewRef.current;
				if (!view) return;
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: text },
					selection: cursorAtEnd ? { anchor: text.length } : undefined,
				});
			},
			insert: (text) => {
				const view = viewRef.current;
				if (!view) return;
				const { from, to } = view.state.selection.main;
				view.dispatch({
					changes: { from, to, insert: text },
					selection: { anchor: from + text.length },
				});
				view.focus();
			},
		};
	}, [apiRef]);

	const extensions = useMemo(() => {
		const keys = keymap.of([
			{
				key: "Mod-Enter",
				run: () => {
					submit.current?.();
					return true;
				},
			},
			{
				key: "Enter",
				run: (view) => {
					if (completionStatus(view.state) === "active") return acceptCompletion(view);
					if (submitOnEnter || singleLine) {
						submit.current?.();
						return true;
					}
					return false;
				},
			},
			{
				key: "Shift-Enter",
				run: (view) => (singleLine ? true : insertNewlineAndIndent(view)),
			},
			{ key: "Tab", run: acceptCompletion },
			{ key: "Ctrl-Space", run: startCompletion },
		]);
		const custom = keymap.of(
			["ArrowUp", "ArrowDown", "Escape", "Mod-l", "Mod-k"].map((key) => ({
				key,
				run: (view: EditorView) => onKeys?.current?.[key]?.(view) ?? false,
			})),
		);
		const list = [
			mongoLanguage,
			syntaxHighlighting(highlight),
			bracketMatching(),
			lintWith(mode, true),
			editorTheme,
			EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "false" }),
			Prec.highest(custom),
			Prec.high(keys),
		];
		if (!singleLine) list.push(EditorView.lineWrapping);
		if (placeholder) list.push(placeholderExt(placeholder));
		if (singleLine) {
			list.push(
				EditorView.theme({
					".cm-content": { padding: "5px 0" },
					".cm-line": { padding: "0 8px" },
				}),
			);
		}
		if (completion) {
			list.push(
				autocompletion({
					activateOnTyping: true,
					icons: false,
					override: [
						(ctx: CompletionContext): CompletionResult | null => {
							const result = complete(
								ctx.state.doc.toString(),
								ctx.pos,
								completion.current ?? { collections: [] },
							);
							if (!result || result.options.length === 0) return null;
							if (result.from === ctx.pos && !ctx.explicit) {
								// Only pop up unprompted right after "." or "{"/"," with a "$".
								const before = ctx.state.doc.sliceString(Math.max(0, ctx.pos - 1), ctx.pos);
								if (before !== ".") return null;
							}
							return {
								from: result.from,
								options: result.options.map((o) => ({
									label: o.label,
									apply: o.apply ?? o.label,
									detail: o.detail,
									type:
										o.kind === "collection"
											? "class"
											: o.kind === "method"
												? "method"
												: o.kind === "field"
													? "property"
													: "keyword",
								})),
								validFor: /^[\w$]*$/,
							};
						},
					],
				}),
			);
		}
		return list;
	}, [mode, singleLine, placeholder, ariaLabel, submitOnEnter, completion, onKeys]);

	return (
		<CodeMirror
			value={value}
			onChange={onChange}
			extensions={extensions}
			theme="none"
			readOnly={readOnly}
			autoFocus={autoFocus}
			basicSetup={{
				lineNumbers,
				foldGutter: false,
				highlightActiveLine: !singleLine,
				highlightActiveLineGutter: lineNumbers,
				autocompletion: false,
				searchKeymap: !singleLine,
				closeBrackets: true,
				bracketMatching: false,
				indentOnInput: true,
				highlightSelectionMatches: false,
			}}
			onCreateEditor={(view) => {
				viewRef.current = view;
			}}
			minHeight={minHeight}
			maxHeight={maxHeight}
			className={cn("min-w-0 overflow-hidden", className)}
		/>
	);
}

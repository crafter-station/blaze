"use client";

import { acceptCompletion, autocompletion, startCompletion } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { sql as sqlLanguage } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { setDiagnostics } from "@codemirror/lint";
import { type EditorState, Prec, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { editorTheme as theme } from "@/components/console-shell/editor-theme";
import { functionCompletionSource, sqlConfig } from "@/lib/sql/completion";
import { splitStatements, statementAt } from "@/lib/sql/split";
import type { SchemaSnapshot, SqlEngine } from "@/lib/sql/types";

/**
 * The SQL editor surface: CodeMirror 6 with schema-aware completion, the active statement
 * tinted, engine errors underlined at the position the engine reported, and the console's
 * keyboard shortcuts bound at the highest precedence so they win over CodeMirror defaults.
 */

export interface EditorApi {
	getDoc(): string;
	/** Main selection range; `from === to` when nothing is selected. */
	getSelection(): { from: number; to: number };
	insert(text: string): void;
	replaceAll(text: string): void;
	select(from: number, to: number): void;
	focus(): void;
}

export interface EditorHandlers {
	run(): void;
	runAll(): void;
	explain(): void;
	format(): void;
	save(): void;
	palette(): void;
}

export interface EditorError {
	from: number;
	to: number;
	message: string;
}

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
		tag: [tags.name, tags.propertyName, tags.special(tags.name)],
		color: "color-mix(in oklab, var(--foreground) 82%, transparent)",
	},
]);

const currentStatementLine = Decoration.line({ class: "cm-current-statement" });

/** Tints the lines of the statement Ctrl+Enter would run, once there is more than one. */
function currentStatement(engine: SqlEngine) {
	const build = (state: EditorState): DecorationSet => {
		const doc = state.doc.toString();
		if (doc.length > 200_000) return Decoration.none;
		const statements = splitStatements(doc, engine);
		const selection = state.selection.main;
		if (statements.length < 2 || !selection.empty) return Decoration.none;
		const statement = statementAt(statements, selection.head);
		if (!statement) return Decoration.none;
		const builder = new RangeSetBuilder<Decoration>();
		const first = state.doc.lineAt(statement.from).number;
		const last = state.doc.lineAt(statement.to).number;
		for (let line = first; line <= last; line++) {
			builder.add(state.doc.line(line).from, state.doc.line(line).from, currentStatementLine);
		}
		return builder.finish();
	};
	return StateField.define<DecorationSet>({
		create: build,
		update(value, tr) {
			return tr.docChanged || tr.selection ? build(tr.state) : value;
		},
		provide: (field) => EditorView.decorations.from(field),
	});
}

export function SqlCodeEditor({
	value,
	onChange,
	engine,
	snapshot,
	handlers,
	error,
	apiRef,
	label,
	wrap = false,
}: {
	value: string;
	onChange: (value: string) => void;
	engine: SqlEngine;
	snapshot: SchemaSnapshot | null;
	handlers: RefObject<EditorHandlers>;
	error: EditorError | null;
	apiRef: RefObject<EditorApi | null>;
	label: string;
	/** Soft-wrap long lines; on narrow screens horizontal scrolling hides most of a query. */
	wrap?: boolean;
}) {
	const viewRef = useRef<EditorView | null>(null);

	const extensions = useMemo(() => {
		const config = sqlConfig(engine, snapshot);
		const language = sqlLanguage(config);
		const call = (name: keyof EditorHandlers) => () => {
			handlers.current[name]();
			return true;
		};
		return [
			language,
			language.language.data.of({ autocomplete: functionCompletionSource(engine, snapshot) }),
			autocompletion({ activateOnTyping: true, icons: true, maxRenderedOptions: 80 }),
			theme,
			syntaxHighlighting(highlight),
			currentStatement(engine),
			...(wrap ? [EditorView.lineWrapping] : []),
			placeholder("Write SQL. Ctrl+Enter runs the statement under the cursor."),
			EditorView.contentAttributes.of({ "aria-label": label, translate: "no" }),
			Prec.highest(
				keymap.of([
					{ key: "Mod-Enter", run: call("run") },
					{ key: "Shift-Mod-Enter", run: call("runAll") },
					{ key: "Shift-Mod-e", run: call("explain") },
					{ key: "Shift-Alt-f", run: call("format") },
					{ key: "Mod-s", run: call("save"), preventDefault: true },
					{ key: "Mod-k", run: call("palette"), preventDefault: true },
					{ key: "Ctrl-Space", run: startCompletion },
					{ key: "Tab", run: acceptCompletion },
				]),
			),
			keymap.of([indentWithTab]),
		];
	}, [engine, snapshot, handlers, label, wrap]);

	useEffect(() => {
		apiRef.current = {
			getDoc: () => viewRef.current?.state.doc.toString() ?? "",
			getSelection: () => {
				const range = viewRef.current?.state.selection.main;
				return { from: range?.from ?? 0, to: range?.to ?? 0 };
			},
			insert: (text) => {
				const view = viewRef.current;
				if (!view) return;
				const range = view.state.selection.main;
				view.dispatch({
					changes: { from: range.from, to: range.to, insert: text },
					selection: { anchor: range.from + text.length },
					scrollIntoView: true,
				});
				view.focus();
			},
			replaceAll: (text) => {
				const view = viewRef.current;
				if (!view) return;
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: text },
					selection: { anchor: Math.min(view.state.selection.main.head, text.length) },
				});
			},
			select: (from, to) => {
				const view = viewRef.current;
				if (!view) return;
				const length = view.state.doc.length;
				view.dispatch({
					selection: { anchor: Math.min(from, length), head: Math.min(to, length) },
					scrollIntoView: true,
				});
				view.focus();
			},
			focus: () => viewRef.current?.focus(),
		};
	}, [apiRef]);

	// Engine errors are shown as a diagnostic exactly where the engine pointed; any edit
	// clears it, because the offsets no longer describe the text.
	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const length = view.state.doc.length;
		const diagnostics =
			error && error.from <= length
				? [
						{
							from: error.from,
							to: Math.min(Math.max(error.to, error.from + 1), length),
							severity: "error" as const,
							message: error.message,
						},
					]
				: [];
		view.dispatch(setDiagnostics(view.state, diagnostics));
	}, [error]);

	return (
		<CodeMirror
			value={value}
			onChange={onChange}
			extensions={extensions}
			theme="none"
			height="100%"
			className="h-full min-h-0 [&_.cm-editor]:h-full"
			onCreateEditor={(view) => {
				viewRef.current = view;
			}}
			basicSetup={{
				lineNumbers: true,
				foldGutter: false,
				highlightActiveLine: true,
				syntaxHighlighting: false,
				autocompletion: false,
				completionKeymap: true,
				bracketMatching: true,
				closeBrackets: true,
				searchKeymap: true,
			}}
		/>
	);
}

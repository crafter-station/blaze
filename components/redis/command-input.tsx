"use client";

import {
	acceptCompletion,
	autocompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult,
	completionStatus,
	startCompletion,
} from "@codemirror/autocomplete";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { type EditorState, Prec, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	keymap,
	placeholder,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { editorTheme } from "@/components/console-shell/editor-theme";
import { type CommandIndex, commandHint, keyPositions, renderSyntax } from "@/lib/redis/commands";
import { tokenize } from "@/lib/redis/tokenize";

/**
 * The console's input: one command per line, like a redis-cli session.
 *
 * - **Enter** runs every line; **Shift+Enter** adds a line.
 * - **↑ / ↓** on the first or last line walk the command history.
 * - Completion offers command names, then subcommands, then the words the command's
 *   syntax allows next (`NX`, `EX`, `MATCH`...). **Tab** accepts.
 * - The remaining syntax is shown after the cursor in a muted ghost, as redis-cli's hints
 *   are: `SET k` → `value [NX | XX] [GET] [EX seconds | ...]`.
 */

export interface InputApi {
	getDoc(): string;
	setDoc(text: string, cursorAtEnd?: boolean): void;
	insert(text: string): void;
	focus(): void;
}

export interface InputHandlers {
	run(): void;
	historyPrev(): boolean;
	historyNext(): boolean;
	clear(): void;
	palette(): void;
}

/* ------------------------------------------------------------------ *
 * Hints: ghost text after the cursor
 * ------------------------------------------------------------------ */

class HintWidget extends WidgetType {
	constructor(readonly text: string) {
		super();
	}
	eq(other: HintWidget) {
		return other.text === this.text;
	}
	toDOM() {
		const span = document.createElement("span");
		span.className = "cm-redis-hint";
		span.textContent = this.text;
		span.setAttribute("aria-hidden", "true");
		return span;
	}
	ignoreEvent() {
		return true;
	}
}

/** The ghost hint for the cursor's line, when the cursor sits at its end. */
export function hintFor(index: CommandIndex | null, lineText: string): string | null {
	if (!index) return null;
	const parsed = tokenize(lineText);
	if (parsed.error || parsed.tokens.length === 0) return null;
	const words = parsed.tokens.map((t) => t.text);
	const result = commandHint(index, words);
	if (!result?.hint) return null;
	// Long syntaxes (SET has a dozen options) are cut; the line below the input has them all.
	const hint = result.hint.length > 88 ? `${result.hint.slice(0, 86).trimEnd()} …` : result.hint;
	return /\s$/.test(lineText) ? hint : ` ${hint}`;
}

function hints(index: CommandIndex | null) {
	const build = (state: EditorState): DecorationSet => {
		const selection = state.selection.main;
		if (!selection.empty) return Decoration.none;
		const line = state.doc.lineAt(selection.head);
		if (selection.head !== line.to) return Decoration.none;
		const hint = hintFor(index, line.text);
		if (!hint) return Decoration.none;
		return Decoration.set([
			Decoration.widget({ widget: new HintWidget(hint), side: 1 }).range(line.to),
		]);
	};
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = build(view.state);
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.selectionSet) this.decorations = build(update.state);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

/* ------------------------------------------------------------------ *
 * Highlighting: command words, quoted strings, key arguments
 * ------------------------------------------------------------------ */

const commandMark = Decoration.mark({ class: "cm-redis-command" });
const stringMark = Decoration.mark({ class: "cm-redis-string" });
const keyMark = Decoration.mark({ class: "cm-redis-key" });
const commentMark = Decoration.mark({ class: "cm-redis-comment" });

function highlighting(index: CommandIndex | null) {
	const build = (view: EditorView): DecorationSet => {
		const builder = new RangeSetBuilder<Decoration>();
		for (const { from, to } of view.visibleRanges) {
			for (let pos = from; pos <= to; ) {
				const line = view.state.doc.lineAt(pos);
				const trimmed = line.text.trimStart();
				if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
					if (line.length) builder.add(line.from, line.to, commentMark);
				} else {
					const { tokens } = tokenize(line.text);
					if (tokens.length) {
						const words = tokens.map((t) => t.text);
						const keys = new Set(index ? keyPositions(index, words) : []);
						const commandWords = index?.[`${words[0]?.toUpperCase()} ${words[1]?.toUpperCase()}`]
							? 2
							: 1;
						tokens.forEach((token, i) => {
							const mark =
								i < commandWords
									? commandMark
									: keys.has(i)
										? keyMark
										: token.quoted
											? stringMark
											: null;
							if (mark && token.to > token.from) {
								builder.add(line.from + token.from, line.from + token.to, mark);
							}
						});
					}
				}
				pos = line.to + 1;
			}
		}
		return builder.finish();
	};
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = build(view);
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

/* ------------------------------------------------------------------ *
 * Completion
 * ------------------------------------------------------------------ */

function matchCase(word: string, typed: string): string {
	return typed && typed === typed.toLowerCase() && /[a-z]/.test(typed) ? word.toLowerCase() : word;
}

function completionSource(index: CommandIndex | null) {
	return (context: CompletionContext): CompletionResult | null => {
		if (!index) return null;
		const line = context.state.doc.lineAt(context.pos);
		const before = line.text.slice(0, context.pos - line.from);
		const parsed = tokenize(before);
		// No completion inside an open quote.
		if (parsed.open) return null;
		const tokens = parsed.tokens;
		const endsWithSpace = /\s$/.test(before) || before.length === 0;
		const current = endsWithSpace ? "" : (tokens.at(-1)?.text ?? "");
		const position = endsWithSpace ? tokens.length : tokens.length - 1;
		if (!context.explicit && !current && position === 0) return null;
		const from = context.pos - current.length;
		const words = tokens.slice(0, position).map((t) => t.text);
		const upper = current.toUpperCase();

		let options: Completion[] = [];
		if (position === 0) {
			options = Object.values(index)
				.filter((spec) => !spec.name.includes(" ") && spec.name.startsWith(upper))
				.map((spec) => ({
					label: matchCase(spec.name, current),
					detail: spec.module ? `${spec.group ?? ""} · ${spec.module}` : spec.group,
					info: () => {
						const node = document.createElement("div");
						const syntax = document.createElement("div");
						syntax.style.fontFamily = "var(--font-mono)";
						syntax.style.color = "var(--foreground)";
						syntax.textContent = renderSyntax(spec);
						node.append(syntax);
						if (spec.summary) {
							const summary = document.createElement("div");
							summary.style.marginTop = "4px";
							summary.textContent = spec.summary;
							node.append(summary);
						}
						return node;
					},
					type: spec.deprecated ? "text" : "keyword",
					boost: spec.deprecated ? -10 : 0,
				}));
		} else {
			const result = commandHint(index, words);
			if (!result) return null;
			const subcommands =
				position === 1 && result.spec.subcommands?.length ? result.spec.subcommands : null;
			const candidates = subcommands ?? result.expect;
			options = candidates
				.filter((word) => word.toUpperCase().startsWith(upper))
				.map((word) => {
					const sub = subcommands ? index[`${result.spec.name} ${word}`] : null;
					return {
						label: matchCase(word, current),
						detail: sub?.summary ? sub.summary.slice(0, 60) : undefined,
						type: "keyword",
					};
				});
		}
		if (options.length === 0) return null;
		return { from, options, validFor: /^[\w.|-]*$/ };
	};
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

const inputTheme = EditorView.theme({
	"&": { height: "auto", backgroundColor: "transparent" },
	".cm-scroller": { maxHeight: "11.5em", overflow: "auto" },
	".cm-content": { padding: "9px 0" },
	".cm-line": { padding: "0 10px 0 2px" },
	".cm-redis-hint": { color: "color-mix(in oklab, var(--muted-foreground) 70%, transparent)" },
	".cm-redis-command": { color: "var(--foreground)", fontWeight: "600" },
	".cm-redis-string": { color: "var(--brand-text)" },
	".cm-redis-key": {
		textDecoration:
			"underline dotted color-mix(in oklab, var(--muted-foreground) 60%, transparent)",
		textUnderlineOffset: "4px",
	},
	".cm-redis-comment": { color: "var(--muted-foreground)", fontStyle: "italic" },
	"&.cm-focused .cm-activeLine": { backgroundColor: "transparent" },
});

export function CommandInput({
	value,
	onChange,
	index,
	handlers,
	apiRef,
	label,
	disabled,
}: {
	value: string;
	onChange: (value: string) => void;
	index: CommandIndex | null;
	handlers: RefObject<InputHandlers>;
	apiRef: RefObject<InputApi | null>;
	label: string;
	disabled?: boolean;
}) {
	const viewRef = useRef<EditorView | null>(null);

	const extensions = useMemo(() => {
		const call = (name: "run" | "clear" | "palette") => () => {
			handlers.current[name]();
			return true;
		};
		return [
			editorTheme,
			// Higher precedence so the input sizes to its content rather than filling a pane.
			Prec.high(inputTheme),
			hints(index),
			highlighting(index),
			autocompletion({
				override: [completionSource(index)],
				activateOnTyping: true,
				icons: false,
				maxRenderedOptions: 60,
			}),
			EditorView.lineWrapping,
			placeholder("Type a command, like SCAN 0 MATCH user:* COUNT 20…"),
			EditorView.contentAttributes.of({
				"aria-label": label,
				translate: "no",
				autocapitalize: "off",
				autocorrect: "off",
				spellcheck: "false",
			}),
			Prec.highest(
				keymap.of([
					{
						key: "Enter",
						run: (view) => {
							// An open completion list takes Enter for itself.
							if (completionStatus(view.state) === "active") return false;
							handlers.current.run();
							return true;
						},
					},
					{ key: "Shift-Enter", run: insertNewlineAndIndent },
					{ key: "Mod-Enter", run: call("run") },
					{
						key: "ArrowUp",
						run: (view) => {
							if (completionStatus(view.state) === "active") return false;
							const line = view.state.doc.lineAt(view.state.selection.main.head);
							return line.number === 1 ? handlers.current.historyPrev() : false;
						},
					},
					{
						key: "ArrowDown",
						run: (view) => {
							if (completionStatus(view.state) === "active") return false;
							const line = view.state.doc.lineAt(view.state.selection.main.head);
							return line.number === view.state.doc.lines ? handlers.current.historyNext() : false;
						},
					},
					{ key: "Mod-l", run: call("clear"), preventDefault: true },
					{ key: "Mod-k", run: call("palette"), preventDefault: true },
					{ key: "Ctrl-Space", run: startCompletion },
					{ key: "Tab", run: acceptCompletion },
				]),
			),
		];
	}, [index, handlers, label]);

	useEffect(() => {
		apiRef.current = {
			getDoc: () => viewRef.current?.state.doc.toString() ?? "",
			setDoc: (text, cursorAtEnd = true) => {
				const view = viewRef.current;
				if (!view) return;
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: text },
					selection: { anchor: cursorAtEnd ? text.length : 0 },
					scrollIntoView: true,
				});
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
			focus: () => viewRef.current?.focus(),
		};
	}, [apiRef]);

	return (
		<CodeMirror
			value={value}
			onChange={onChange}
			extensions={extensions}
			theme="none"
			editable={!disabled}
			autoFocus
			className="min-w-0 flex-1 [&_.cm-editor]:bg-transparent"
			onCreateEditor={(view) => {
				viewRef.current = view;
			}}
			basicSetup={{
				lineNumbers: false,
				foldGutter: false,
				highlightActiveLine: false,
				highlightActiveLineGutter: false,
				syntaxHighlighting: false,
				autocompletion: false,
				completionKeymap: true,
				bracketMatching: false,
				// redis-cli does not pair quotes, and a paired quote follows Shift+Enter onto the
				// next line, turning a typo into two broken commands.
				closeBrackets: false,
				searchKeymap: false,
				history: true,
			}}
		/>
	);
}

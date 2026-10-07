import { EditorView } from "@codemirror/view";

/**
 * CodeMirror chrome shared by the SQL editor and the Redis command input: design-system
 * colours, the brand caret and selection, and popovers that match the app's own menus.
 */
export const editorTheme = EditorView.theme({
	"&": {
		backgroundColor: "var(--code-background)",
		color: "var(--foreground)",
		fontSize: "13px",
		height: "100%",
	},
	".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
	".cm-content": { padding: "10px 0", caretColor: "var(--brand)" },
	".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--brand)", borderLeftWidth: "2px" },
	"&.cm-focused": { outline: "none" },
	".cm-gutters": {
		backgroundColor: "var(--code-background)",
		color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)",
		border: "none",
	},
	".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 14px", minWidth: "40px" },
	".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
	".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--foreground) 3%, transparent)" },
	"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
		{ backgroundColor: "color-mix(in oklab, var(--brand) 22%, transparent) !important" },
	".cm-placeholder": { color: "var(--muted-foreground)", fontStyle: "normal" },
	".cm-current-statement": {
		backgroundImage:
			"linear-gradient(to right, color-mix(in oklab, var(--brand) 55%, transparent) 2px, transparent 2px)",
		backgroundColor: "color-mix(in oklab, var(--foreground) 2%, transparent)",
	},
	".cm-matchingBracket": {
		backgroundColor: "color-mix(in oklab, var(--foreground) 10%, transparent)",
		outline: "none",
	},
	".cm-tooltip": {
		backgroundColor: "var(--popover)",
		color: "var(--popover-foreground)",
		border: "1px solid var(--border)",
		borderRadius: "8px",
		boxShadow: "var(--shadow-md)",
		overflow: "hidden",
	},
	".cm-tooltip-autocomplete > ul": {
		fontFamily: "var(--font-mono)",
		fontSize: "12.5px",
		maxHeight: "18em",
	},
	".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px 3px 6px", lineHeight: "1.5" },
	".cm-tooltip-autocomplete > ul > li[aria-selected]": {
		backgroundColor: "var(--accent)",
		color: "var(--foreground)",
	},
	".cm-completionLabel": { color: "var(--foreground)" },
	".cm-completionMatchedText": {
		textDecoration: "none",
		color: "var(--brand-text)",
		fontWeight: "600",
	},
	".cm-completionDetail": {
		marginLeft: "1.25em",
		color: "var(--muted-foreground)",
		fontStyle: "normal",
		fontSize: "11.5px",
	},
	".cm-completionIcon": { opacity: "0.7", width: "1.4em", paddingRight: "0.4em" },
	".cm-completionInfo": {
		fontFamily: "var(--font-sans)",
		fontSize: "12px",
		padding: "6px 10px",
		color: "var(--muted-foreground)",
	},
	".cm-lintRange-error": {
		backgroundImage: "none",
		textDecoration: "underline wavy var(--destructive)",
		textDecorationSkipInk: "none",
		textUnderlineOffset: "3px",
		backgroundColor: "color-mix(in oklab, var(--destructive) 12%, transparent)",
	},
	".cm-diagnostic": { fontFamily: "var(--font-mono)", fontSize: "12px", padding: "6px 10px" },
	".cm-diagnostic-error": { borderLeft: "3px solid var(--destructive)" },
	".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)" },
	".cm-search input, .cm-search button": { fontSize: "12px" },
});

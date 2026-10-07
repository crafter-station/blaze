import type { CommandIndex } from "./commands";
import type { Reply } from "./reply";

/**
 * Shapes shared by the Redis console and key browser on both sides of the server-action
 * boundary. Plain JSON only.
 */

export type Failure = { ok: false; error: string; friendly?: string };

/** One console line, as it ran (or why it did not). */
export interface CommandOutcome {
	line: string;
	ok: boolean;
	reply?: Reply;
	/** Why the line did not produce a reply: a syntax error, a refusal, a lost connection. */
	error?: string;
	kind?: "syntax" | "blocked" | "confirm" | "connection" | "skipped";
	/** Plain-language reading of an engine error (a full database, a refused command). */
	friendly?: string;
	/** Something the console changed, e.g. a blocking timeout it capped. */
	note?: string;
	truncated?: boolean;
	durationMs: number;
}

export interface ConsoleRun {
	results: CommandOutcome[];
	/** A failure before any line ran (not found, suspended, could not connect). */
	error?: string;
}

export interface ServerInfo {
	version: string | null;
	/** Loaded module names as MODULE LIST reports them, e.g. `ReJSON`, `search`. */
	modules: string[];
}

export interface CommandReference {
	index: CommandIndex;
	server: ServerInfo;
	/** True when COMMAND DOCS failed and the index holds names only. */
	namesOnly?: boolean;
}

/** Whether the ReJSON module is loaded, under any of the names it registers. */
export function hasJsonModule(server: ServerInfo | null | undefined): boolean {
	return !!server?.modules.some((m) => /^(ReJSON|json)$/i.test(m));
}

/** Friendly module names for display. */
export const MODULE_LABEL: Record<string, string> = {
	ReJSON: "JSON",
	search: "Search",
	timeseries: "Time series",
	bf: "Probabilistic",
	vectorset: "Vector sets",
};

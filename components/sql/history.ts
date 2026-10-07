"use client";

import { createHistoryStore } from "@/components/console-shell/history";

/** One SQL console run, as the history panel lists it. */
export interface HistoryEntry {
	id: string;
	sql: string;
	at: number;
	durationMs: number;
	ok: boolean;
	statements: number;
	/** Rows of the last statement that returned any. */
	rows?: number;
	error?: string;
}

const store = createHistoryStore<HistoryEntry>({
	key: (databaseId) => `blaze.sql.history.${databaseId}`,
	identity: (entry) => entry.sql,
	valid: (entry): entry is HistoryEntry =>
		!!entry && typeof (entry as HistoryEntry).sql === "string",
});

export const readHistory = store.read;
export const pushHistory = store.push;
export const clearHistory = store.clear;

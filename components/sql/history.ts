"use client";

/**
 * Per-database query history, kept in this browser only. Capped, and every access is
 * wrapped: private windows, full quotas and disabled storage all degrade to "no history"
 * rather than breaking the console.
 */

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

const LIMIT = 100;
const key = (databaseId: string) => `blaze.sql.history.${databaseId}`;

export function readHistory(databaseId: string): HistoryEntry[] {
	try {
		const raw = localStorage.getItem(key(databaseId));
		const parsed = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
		return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.sql === "string") : [];
	} catch {
		return [];
	}
}

export function pushHistory(databaseId: string, entry: HistoryEntry): HistoryEntry[] {
	const current = readHistory(databaseId);
	// Re-running the same SQL moves it to the top instead of duplicating it.
	const next = [entry, ...current.filter((e) => e.sql !== entry.sql)].slice(0, LIMIT);
	try {
		localStorage.setItem(key(databaseId), JSON.stringify(next));
	} catch {
		// Quota exceeded or storage disabled: keep the in-memory list for this session.
	}
	return next;
}

export function clearHistory(databaseId: string) {
	try {
		localStorage.removeItem(key(databaseId));
	} catch {}
}

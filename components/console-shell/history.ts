"use client";

/**
 * Per-database run history, kept in this browser only. Capped, and every access is
 * wrapped: private windows, full quotas and disabled storage all degrade to "no history"
 * rather than breaking the console.
 *
 * Each console keeps its own entry shape and storage key; this is the storage policy
 * they share.
 */

export interface HistoryStore<T> {
	read(databaseId: string): T[];
	/** Adds an entry at the top and returns the new list. */
	push(databaseId: string, entry: T): T[];
	clear(databaseId: string): void;
}

export function createHistoryStore<T extends object>(options: {
	/** localStorage key for one database's history. */
	key: (databaseId: string) => string;
	/** Entries with the same identity replace each other instead of piling up. */
	identity: (entry: T) => string;
	/** Rejects stored entries that are not this console's shape. */
	valid: (entry: unknown) => entry is T;
	limit?: number;
}): HistoryStore<T> {
	const limit = options.limit ?? 100;
	const read = (databaseId: string): T[] => {
		try {
			const raw = localStorage.getItem(options.key(databaseId));
			const parsed: unknown = raw ? JSON.parse(raw) : [];
			return Array.isArray(parsed) ? parsed.filter(options.valid) : [];
		} catch {
			return [];
		}
	};
	return {
		read,
		push(databaseId, entry) {
			const id = options.identity(entry);
			// Re-running the same thing moves it to the top instead of duplicating it.
			const next = [entry, ...read(databaseId).filter((e) => options.identity(e) !== id)].slice(
				0,
				limit,
			);
			try {
				localStorage.setItem(options.key(databaseId), JSON.stringify(next));
			} catch {
				// Quota exceeded or storage disabled: keep the in-memory list for this session.
			}
			return next;
		},
		clear(databaseId) {
			try {
				localStorage.removeItem(options.key(databaseId));
			} catch {}
		},
	};
}

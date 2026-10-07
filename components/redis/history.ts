"use client";

import { createHistoryStore } from "@/components/console-shell/history";

/** One Redis console run: the commands sent together, newest first in the list. */
export interface RedisHistoryEntry {
	id: string;
	/** The run's lines, joined by newlines. */
	text: string;
	at: number;
	durationMs: number;
	ok: boolean;
	commands: number;
}

const store = createHistoryStore<RedisHistoryEntry>({
	key: (databaseId) => `blaze.redis.history.${databaseId}`,
	identity: (entry) => entry.text,
	valid: (entry): entry is RedisHistoryEntry =>
		!!entry && typeof (entry as RedisHistoryEntry).text === "string",
	limit: 200,
});

export const readRedisHistory = store.read;
export const pushRedisHistory = store.push;
export const clearRedisHistory = store.clear;

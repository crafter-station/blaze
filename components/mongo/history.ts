"use client";

import { createHistoryStore } from "@/components/console-shell/history";

/** One Mongo shell command as it ran, newest first in the list. */
export interface MongoHistoryEntry {
	id: string;
	text: string;
	at: number;
	durationMs: number;
	ok: boolean;
}

const store = createHistoryStore<MongoHistoryEntry>({
	key: (databaseId) => `blaze.mongo.history.${databaseId}`,
	identity: (entry) => entry.text,
	valid: (entry): entry is MongoHistoryEntry =>
		!!entry && typeof (entry as MongoHistoryEntry).text === "string",
	limit: 200,
});

export const readMongoHistory = store.read;
export const pushMongoHistory = store.push;
export const clearMongoHistory = store.clear;

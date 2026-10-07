import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "./control/db";
import { type SavedQuery, savedQueries } from "./control/schema";
import { newId } from "./id";
import { LIMITS } from "./limits";

/**
 * Saved SQL console queries. Every read and write is keyed by both the user and the
 * database, so an id from the client can only ever address that user's own query on a
 * database the caller has already proven they own.
 */

export interface SavedQueryView {
	id: string;
	name: string;
	sql: string;
	updatedAt: string;
}

export class SavedQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SavedQueryError";
	}
}

function view(row: SavedQuery): SavedQueryView {
	return { id: row.id, name: row.name, sql: row.sql, updatedAt: row.updatedAt.toISOString() };
}

function clean(name: string, sql: string) {
	const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 120);
	if (!trimmed) throw new SavedQueryError("Give the query a name.");
	if (!sql.trim()) throw new SavedQueryError("There is no SQL to save.");
	if (sql.length > LIMITS.SAVED_QUERY_MAX_CHARS) {
		throw new SavedQueryError(
			`Saved queries are limited to ${LIMITS.SAVED_QUERY_MAX_CHARS.toLocaleString("en-US")} characters.`,
		);
	}
	return { name: trimmed, sql };
}

export async function listSavedQueries(
	userId: string,
	databaseId: string,
): Promise<SavedQueryView[]> {
	const rows = await db
		.select()
		.from(savedQueries)
		.where(and(eq(savedQueries.userId, userId), eq(savedQueries.databaseId, databaseId)))
		.orderBy(desc(savedQueries.updatedAt))
		.limit(LIMITS.SAVED_QUERIES_PER_DATABASE);
	return rows.map(view);
}

export async function createSavedQuery(
	userId: string,
	databaseId: string,
	input: { name: string; sql: string },
): Promise<SavedQueryView> {
	const values = clean(input.name, input.sql);
	const [{ total }] = await db
		.select({ total: count() })
		.from(savedQueries)
		.where(and(eq(savedQueries.userId, userId), eq(savedQueries.databaseId, databaseId)));
	if (total >= LIMITS.SAVED_QUERIES_PER_DATABASE) {
		throw new SavedQueryError(
			`You can save up to ${LIMITS.SAVED_QUERIES_PER_DATABASE} queries per database. Delete one first.`,
		);
	}
	const [row] = await db
		.insert(savedQueries)
		.values({ id: newId("sq"), userId, databaseId, ...values })
		.returning();
	return view(row);
}

export async function updateSavedQuery(
	userId: string,
	databaseId: string,
	id: string,
	input: { name: string; sql: string },
): Promise<SavedQueryView> {
	const values = clean(input.name, input.sql);
	const [row] = await db
		.update(savedQueries)
		.set({ ...values, updatedAt: new Date() })
		.where(
			and(
				eq(savedQueries.id, id),
				eq(savedQueries.userId, userId),
				eq(savedQueries.databaseId, databaseId),
			),
		)
		.returning();
	if (!row) throw new SavedQueryError("That saved query no longer exists.");
	return view(row);
}

export async function deleteSavedQuery(userId: string, databaseId: string, id: string) {
	await db
		.delete(savedQueries)
		.where(
			and(
				eq(savedQueries.id, id),
				eq(savedQueries.userId, userId),
				eq(savedQueries.databaseId, databaseId),
			),
		);
}

import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./control/db";
import { apiKeys, auditLog, databases, type User, users } from "./control/schema";
import { newId } from "./id";
import { destroyDatabase } from "./provision";

export class AccountDeletionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AccountDeletionError";
	}
}

/**
 * Delete an account and everything it owns.
 *
 * Ordering is the whole design here. Physical databases are dropped **first**, and if any
 * drop fails the whole operation aborts with nothing else touched. The tempting order —
 * delete the control-plane rows, then clean up the engines — loses the only record of
 * which databases and roles existed the moment it half-fails, leaving tenant data on disk
 * that nothing will ever reclaim and no one can find.
 *
 * Clerk is deleted last, for the same reason: while it exists the user can still sign in
 * and see what happened. If everything before it succeeded and Clerk deletion fails, the
 * user is left with an empty account rather than an inconsistent one.
 */
export async function deleteAccount(user: User): Promise<{ databasesDropped: number }> {
	const owned = await db.query.databases.findMany({
		where: and(eq(databases.ownerUserId, user.id), isNull(databases.deletedAt)),
	});

	let dropped = 0;
	for (const record of owned) {
		try {
			await destroyDatabase(user, record.id);
			dropped++;
		} catch (error) {
			throw new AccountDeletionError(
				`Could not drop ${record.name}, so nothing was deleted. ${
					error instanceof Error ? error.message : ""
				}`.trim(),
			);
		}
	}

	await db.insert(auditLog).values({
		id: newId("usr"),
		actorUserId: user.id,
		action: "account.delete",
		targetType: "user",
		targetId: user.id,
		metadata: { email: user.email, databasesDropped: dropped },
	});

	await db.delete(apiKeys).where(eq(apiKeys.userId, user.id));

	// The audit row deliberately outlives the user, so actorUserId is not a foreign key.
	await db.delete(databases).where(eq(databases.ownerUserId, user.id));
	await db.delete(users).where(eq(users.id, user.id));

	const clerk = await clerkClient();
	await clerk.users.deleteUser(user.clerkUserId);

	return { databasesDropped: dropped };
}

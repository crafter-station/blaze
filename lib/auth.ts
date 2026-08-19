import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "./control/db";
import type { User } from "./control/schema";
import { users } from "./control/schema";
import { newId } from "./id";

export class UnauthorizedError extends Error {
	constructor(message = "Unauthorized") {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export class SuspendedError extends Error {
	constructor(message = "Account suspended") {
		super(message);
		this.name = "SuspendedError";
	}
}

/**
 * Resolve the signed-in Clerk session to blaze's local user row, creating it on first
 * sight.
 *
 * Clerk owns authentication; this row exists so quotas, projects and databases have a
 * stable local foreign key. Signup is OAuth-only (GitHub and Google) — configured in the
 * Clerk dashboard, not here — so there are no password accounts and no disposable-email
 * signups to screen for (PLAN.md Q14).
 */
export async function requireUser(): Promise<User> {
	const { userId } = await auth();
	if (!userId) throw new UnauthorizedError();

	const existing = await db.query.users.findFirst({
		where: eq(users.clerkUserId, userId),
	});

	if (existing) {
		if (existing.suspendedAt) throw new SuspendedError();
		return existing;
	}

	const clerkUser = await currentUser();
	const email = clerkUser?.primaryEmailAddress?.emailAddress;
	if (!email) throw new UnauthorizedError("No verified email address on account");

	const [created] = await db
		.insert(users)
		.values({ id: newId("usr"), clerkUserId: userId, email })
		.returning();

	return created;
}

/** Like `requireUser`, but returns null instead of throwing. For optional-auth pages. */
export async function getUser(): Promise<User | null> {
	try {
		return await requireUser();
	} catch {
		return null;
	}
}

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sweepIfDue } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Metrics sweep. Intended to run every 5 minutes.
 *
 * Authenticated with a shared secret rather than left open, because this endpoint can
 * suspend databases: it is the storage-quota enforcement path, not a read-only sampler.
 * With `CRON_SECRET` unset the endpoint refuses everything — failing closed, since the
 * alternative is an unauthenticated way to hammer every tenant's instance.
 */
function authorized(request: Request): boolean {
	const secret = env.CRON_SECRET;
	if (!secret) return false;

	const header = request.headers.get("authorization") ?? "";
	const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

	const a = Buffer.from(provided);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
	if (!authorized(request)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const started = Date.now();

	// `force` bypasses the "is a sweep due yet" check but never the advisory lock, so a
	// manual trigger can always get a fresh sample without being able to collide with the
	// in-process scheduler.
	const force = new URL(request.url).searchParams.get("force") === "1";
	const result = await sweepIfDue(force);

	return NextResponse.json({ ...result, tookMs: Date.now() - started });
}

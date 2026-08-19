/**
 * Starts the metrics sweep inside the app process.
 *
 * The sweep enforces the storage quota, so "nobody remembered to configure the cron" is
 * not an acceptable failure mode — until this existed the 500MB limit was shown in the
 * dashboard but never enforced between manual samples, which is worse than no limit at
 * all because the UI claimed one.
 *
 * This file deliberately imports **nothing**. Next compiles `instrumentation.ts` for the
 * edge runtime as well as node, and an import of the metrics module pulls `node:crypto`
 * through `lib/id` into a bundle that cannot support it — which fails the build even
 * though a `NEXT_RUNTIME` guard means the code would never execute there. A runtime guard
 * stops execution, not bundling.
 *
 * So the timer calls the app's own HTTP endpoint over loopback instead. That keeps this
 * file dependency-free and has a real benefit: the in-process schedule and any external
 * scheduler drive the identical code path, guards included, so there is only one
 * behaviour to reason about.
 */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;

	// Not in development: a loop that suspends databases has no business running because
	// someone ran `next dev` with the deployed DATABASE_URL.
	if (process.env.NODE_ENV !== "production") return;

	const secret = process.env.CRON_SECRET;
	if (!secret) {
		console.warn("[metrics] CRON_SECRET is not set — sweep not scheduled, quotas unenforced");
		return;
	}

	const port = process.env.PORT ?? "3000";
	const url = `http://127.0.0.1:${port}/api/cron/metrics`;
	const intervalMs = 5 * 60_000;

	async function tick() {
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { Authorization: `Bearer ${secret}` },
			});
			const body = await response.json();
			if (body.ran) {
				console.log(
					`[metrics] swept ${body.sampled} database(s), ${body.suspended} suspended, ${body.errors} error(s)`,
				);
			}
		} catch (error) {
			// A failed sweep must never take the server down with it.
			console.error("[metrics] sweep failed:", error instanceof Error ? error.message : error);
		}
	}

	// Delay the first tick: on a fresh deploy the server is still binding its port and the
	// control plane may still be starting, and a boot-time failure would log an alarming
	// error for no reason.
	setTimeout(tick, 30_000);

	const timer = setInterval(tick, intervalMs);
	// Never hold the process open for the timer's sake.
	timer.unref?.();

	console.log(`[metrics] sweep scheduled every ${intervalMs / 60_000} minutes`);
}

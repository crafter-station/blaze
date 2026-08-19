/**
 * Starts the metrics sweep inside the app process.
 *
 * The sweep enforces the storage quota, so "nobody remembered to configure the cron" is
 * not an acceptable failure mode — until this existed, the 500MB limit was documented but
 * unenforced, which is worse than having no limit because the dashboard claimed one.
 *
 * Scheduling it in-process rather than as an external cron is a deliberate trade. It
 * deploys with the code, needs no secret, and cannot be forgotten when the app moves
 * hosts. The cost is that it lives and dies with the server process and is less
 * observable than a real scheduler — so `POST /api/cron/metrics` still exists for an
 * external scheduler to drive, and both paths go through the same `sweepIfDue` guards.
 */
export async function register() {
	// `register` also runs for the edge runtime, which has no pg and no timers worth using.
	if (process.env.NEXT_RUNTIME !== "nodejs") return;

	// Not in dev: a background loop that suspends databases has no business running against
	// production data because someone ran `next dev` with the deployed DATABASE_URL.
	if (process.env.NODE_ENV !== "production") return;

	const { METRICS_INTERVAL_MS } = await import("@/lib/limits");
	const { sweepIfDue } = await import("@/lib/metrics");

	async function tick() {
		try {
			const result = await sweepIfDue();
			if (result.ran) {
				console.log(
					`[metrics] swept ${result.sampled} database(s), ${result.suspended} suspended, ${result.errors} error(s)`,
				);
			}
		} catch (error) {
			// A failed sweep must never take the server down with it.
			console.error("[metrics] sweep failed:", error instanceof Error ? error.message : error);
		}
	}

	// Wait before the first tick: on a fresh deploy the control plane may still be coming
	// up, and a sweep that fails on boot would log an alarming error for no reason.
	setTimeout(tick, 30_000);

	const timer = setInterval(tick, METRICS_INTERVAL_MS);
	// Do not hold the process open for the sake of the timer.
	timer.unref?.();

	console.log(`[metrics] sweep scheduled every ${METRICS_INTERVAL_MS / 60_000} minutes`);
}

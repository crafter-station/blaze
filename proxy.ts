import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Next 16 renames `middleware.ts` to `proxy.ts`. Same contract, same matcher config.
 *
 * Public: the marketing site, auth screens, and the whole `/v1` API — the API
 * authenticates with its own bearer API keys rather than a Clerk session, so Clerk must
 * not intercept it. Everything else requires a signed-in user.
 */
const isPublicRoute = createRouteMatcher([
	"/",
	"/sign-in(.*)",
	"/sign-up(.*)",
	"/waitlist(.*)",
	"/v1(.*)",
	"/api/health",
	// Authenticates with its own shared secret, not a Clerk session.
	"/api/cron(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
	if (!isPublicRoute(req)) {
		await auth.protect();
	}
});

export const config = {
	matcher: [
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		"/(api|v1)(.*)",
	],
};

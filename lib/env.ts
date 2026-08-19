import "server-only";
import { z } from "zod";

/**
 * Server environment. Validated once at module load so a misconfigured deploy fails
 * immediately and loudly rather than at the first database provision.
 */
const schema = z.object({
	/** blaze's own control-plane Postgres — not a tenant database. */
	DATABASE_URL: z.string().url(),

	/**
	 * 32 bytes, hex-encoded, for AES-256-GCM. Tenant connection passwords are encrypted
	 * with this and not hashed, because the dashboard has to display the connection string.
	 * Generate with: openssl rand -hex 32
	 */
	ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, "ENCRYPTION_KEY must be 64 hex chars"),

	/**
	 * Apex domain that connection hostnames hang off, e.g. `blaze.run` produces
	 * `pg.blaze.run`. Never an IP — see PLAN.md §3.
	 */
	BLAZE_DOMAIN: z.string().min(1),

	CLERK_SECRET_KEY: z.string().min(1),

	/**
	 * Dokploy, used only to provision dedicated containers (redis, libsql).
	 *
	 * Optional: the shared engines never touch it, so requiring it would block a deploy on
	 * a credential the running code has no use for. `lib/dokploy/client.ts` fails loudly if
	 * something actually tries to call Dokploy without it.
	 */
	DOKPLOY_API_URL: z.string().url().default("https://vps.crafter.run/api"),
	DOKPLOY_API_KEY: z.string().optional(),

	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
	const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
	throw new Error(`Invalid environment:\n${issues}`);
}

export const env = parsed.data;

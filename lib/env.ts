import "server-only";
import { z } from "zod";

/**
 * Server environment, validated on first access.
 *
 * Validation is lazy, not eager, and that is load-bearing rather than a style choice.
 * `next build` imports every route module to collect page data, so anything that throws
 * at import time fails the build — which is exactly what happened on the first deploy:
 * `/api/health` imports the control-plane client, which imports this, which threw because
 * `DATABASE_URL` is a runtime secret and deliberately not a Docker build arg.
 *
 * Deferring to first property access keeps the useful property — a misconfigured deploy
 * fails immediately and loudly on the first request rather than limping — without
 * requiring secrets to be present at build time.
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
	 * Public origin. Load-bearing for MCP OAuth: the advertised `resource` is the audience
	 * tokens are bound to, and behind Traefik a request-derived URL is the container's own
	 * address, so a token would be minted for the wrong audience.
	 */
	APP_URL: z.string().url().optional(),

	/**
	 * Dokploy, used only to provision dedicated containers (redis, libsql).
	 *
	 * Optional: the shared engines never touch it, so requiring it would block a deploy on
	 * a credential the running code has no use for. `lib/dokploy/client.ts` fails loudly if
	 * something actually tries to call Dokploy without it.
	 */
	DOKPLOY_API_URL: z.string().url().default("https://vps.crafter.run/api"),
	DOKPLOY_API_KEY: z.string().optional(),

	/** Dokploy environment new tenant containers are created in. */
	DOKPLOY_ENVIRONMENT_ID: z.string().optional(),

	/**
	 * Image for tenant Redis containers.
	 *
	 * Not `redis:8`: the stock image starts a plaintext server with no quota and a
	 * `default` user that can rewrite its own configuration. blaze builds an image that
	 * fixes all three at startup, because Dokploy overrides ENTRYPOINT/CMD for database
	 * services and drops any command we would otherwise pass. Served from a registry on
	 * the host — Swarm resolves every image through a registry, so a locally built image
	 * it cannot pull is invisible to it.
	 */
	BLAZE_REDIS_IMAGE: z.string().default("127.0.0.1:5000/blaze/redis-tls:3"),

	/**
	 * Directory the SNI router watches for per-tenant routes. Bind-mounted from the host,
	 * so writing a file here publishes a route without restarting anything.
	 */
	SNI_DYNAMIC_DIR: z.string().default("/sni-dynamic"),

	/**
	 * Shared secret for the metrics cron endpoint. Optional: when unset the endpoint refuses
	 * every request rather than running unauthenticated, because that endpoint can suspend
	 * databases.
	 */
	CRON_SECRET: z.string().min(16).optional(),

	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function load(): Env {
	const parsed = schema.safeParse(process.env);
	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
		throw new Error(`Invalid environment:\n${issues}`);
	}
	return parsed.data;
}

export const env = new Proxy({} as Env, {
	get(_target, prop) {
		if (!cached) cached = load();
		return cached[prop as keyof Env];
	},
});

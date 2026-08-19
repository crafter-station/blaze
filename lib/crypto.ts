import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

/**
 * Deliberately does not import `lib/env`, and deliberately has no `server-only` guard:
 * bootstrap and migration scripts run outside Next and must write secrets in exactly this
 * format. Reimplementing AES-GCM in a script would work right up until the format changed,
 * and then produce ciphertext the app silently cannot decrypt.
 *
 * The key is read lazily so importing this module never throws at load time.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function key(): Buffer {
	const raw = process.env.ENCRYPTION_KEY;
	if (!raw || !/^[0-9a-f]{64}$/.test(raw)) {
		throw new Error("ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)");
	}
	return Buffer.from(raw, "hex");
}

/**
 * Encrypt a tenant's database password.
 *
 * Deliberately reversible: the dashboard and the API both have to render a working
 * connection string, so these cannot be hashed the way `api_keys` are. Stored as
 * `iv.tag.ciphertext`, all base64url.
 */
export function encryptSecret(plaintext: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [iv, tag, ciphertext].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(encoded: string): string {
	const parts = encoded.split(".");
	if (parts.length !== 3) throw new Error("Malformed encrypted secret");
	const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64url"));
	const decipher = createDecipheriv(ALGORITHM, key(), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/* ------------------------------------------------------------------ *
 * API keys — hashed, never reversible. Shown to the user exactly once.
 * ------------------------------------------------------------------ */

export interface GeneratedApiKey {
	/** Full secret, shown once at creation and never again. */
	token: string;
	/** Stored for lookup and for display as `blz_live_a1b2...`. */
	prefix: string;
	hash: string;
}

export function generateApiKey(): GeneratedApiKey {
	const token = `blz_live_${randomBytes(24).toString("base64url")}`;
	return { token, prefix: token.slice(0, 16), hash: hashApiKey(token) };
}

export function hashApiKey(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export function apiKeyMatches(token: string, storedHash: string): boolean {
	const a = Buffer.from(hashApiKey(token), "hex");
	const b = Buffer.from(storedHash, "hex");
	return a.length === b.length && timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ *
 * Credentials handed to tenants.
 * ------------------------------------------------------------------ */

/**
 * Passwords go into connection URLs, so the alphabet avoids anything that would need
 * percent-encoding and confuse a copy-pasted string.
 */
export function generatePassword(length = 24): string {
	const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	const bytes = randomBytes(length);
	return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

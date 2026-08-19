import { randomBytes } from "node:crypto";

/**
 * Prefixed, URL-safe, sortable-enough public identifiers: `db_x7f2k9m3q1w8`.
 *
 * The prefix makes API errors and support conversations legible ("that's a project id,
 * not a database id") and lets the router validate shape before touching the database.
 * Alphabet excludes look-alike characters so ids survive being read aloud or retyped.
 */
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

export type IdPrefix = "usr" | "proj" | "db" | "node" | "inst" | "key" | "bkp";

export function newId(prefix: IdPrefix, length = 12): string {
	const bytes = randomBytes(length);
	const body = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
	return `${prefix}_${body}`;
}

/**
 * A slug safe to use as a Postgres/MySQL identifier and as a DNS label.
 * Lowercase, alphanumeric plus hyphens, never leading or trailing hyphen.
 */
export function slugify(input: string, fallback = "database"): string {
	const slug = input
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);
	return slug || fallback;
}

/**
 * Physical name for a tenant database or role.
 *
 * Never derived from user input alone: two users may both want "myapp", and on a shared
 * instance those collide. The random suffix guarantees uniqueness within the instance.
 */
export function physicalName(prefix: "db" | "u", slug: string): string {
	const suffix = randomBytes(4).reduce((s, b) => s + ALPHABET[b % ALPHABET.length], "");
	return `${prefix}_${slugify(slug).replace(/-/g, "_")}_${suffix}`.slice(0, 63);
}

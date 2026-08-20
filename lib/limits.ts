/**
 * Free-tier quotas.
 *
 * There is no billing (PLAN.md Q8), so these limits *are* the business model. They are
 * enforced in two places and both are required:
 *
 *  1. at creation time, in the API — cheap, immediate, gives a good error message;
 *  2. by the reaper and metrics poller — the only thing that catches a database that
 *     grew past its quota after it was created.
 *
 * Postgres has no native per-database disk quota, so (2) is not belt-and-braces: it is
 * the actual storage enforcement mechanism. See PLAN.md §6.
 */

export const LIMITS = {
	/** Databases per user, across all projects and engines. */
	DATABASES_PER_USER: 5,

	/** Storage per database, in bytes. */
	STORAGE_BYTES: 500 * 1024 * 1024,

	/**
	 * Storage per Redis database, in bytes — deliberately far below `STORAGE_BYTES`.
	 *
	 * Redis keeps its dataset in memory, so this quota is not disk that is cheap and
	 * shared but RAM that is neither. It is applied as `maxmemory` on each tenant's own
	 * container, which means Redis refuses the write itself rather than a sweep noticing
	 * five minutes later that the host is already under pressure.
	 */
	REDIS_MEMORY_BYTES: 64 * 1024 * 1024,

	/** Concurrent connections per tenant role. */
	CONNECTION_LIMIT: 20,

	/** Longest a single statement may run. */
	STATEMENT_TIMEOUT_MS: 30_000,

	/** Longest a transaction may sit idle holding locks. */
	IDLE_TRANSACTION_TIMEOUT_MS: 60_000,

	/** API keys per user. */
	API_KEYS_PER_USER: 10,
} as const;

/**
 * TTL. Humans get no expiry by default; agents are nudged towards one because they
 * create databases at machine speed and rarely clean up.
 */
export const TTL = {
	/** Suggested to API/MCP callers that omit a ttl. Not forced. */
	SUGGESTED_AGENT_MS: 24 * 60 * 60 * 1000,
	/** Longest ttl anyone may request. */
	MAX_MS: 30 * 24 * 60 * 60 * 1000,
} as const;

/** Nightly logical dumps to MinIO, 7-day retention (PLAN.md §2, Q15). */
export const BACKUP_RETENTION_DAYS = 7;

/** How often the metrics poller runs. Doubles as the storage-quota check interval. */
export const METRICS_INTERVAL_MS = 5 * 60 * 1000;

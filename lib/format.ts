/**
 * Display formatting shared by the dashboard.
 *
 * Lives outside the page files because the same value must read identically in the list,
 * the detail page and the overview — a database showing "0.49 MB" in one place and
 * "500 KB" in another looks like two different databases.
 */

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatExpiry(expiresAt: Date | null): string | null {
	if (!expiresAt) return null;
	const ms = expiresAt.getTime() - Date.now();
	if (ms <= 0) return "expired";
	const hours = Math.round(ms / 3_600_000);
	if (hours < 1) return "under 1h";
	return hours < 48 ? `in ${hours}h` : `in ${Math.round(hours / 24)}d`;
}

/** Percentage of a quota consumed, clamped so an over-quota database still renders. */
export function percentOf(used: number, limit: number): number {
	return Math.min(100, Math.round((used / limit) * 100));
}

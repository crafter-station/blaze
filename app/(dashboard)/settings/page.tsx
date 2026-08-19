import { and, count, eq, isNull } from "drizzle-orm";
import { DeleteAccount } from "@/components/dashboard/delete-account";
import { listApiKeys } from "@/lib/api-keys";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/control/db";
import { databases } from "@/lib/control/schema";
import { ENGINE_CONFIG, ENGINES } from "@/lib/engines/types";
import { formatBytes, formatDate } from "@/lib/format";
import { LIMITS, TTL } from "@/lib/limits";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
	const user = await requireUser();

	const [[{ value: databaseCount }], keys] = await Promise.all([
		db
			.select({ value: count() })
			.from(databases)
			.where(and(eq(databases.ownerUserId, user.id), isNull(databases.deletedAt))),
		listApiKeys(user.id),
	]);

	return (
		<div className="space-y-8">
			<div>
				<h1 className="font-semibold text-[42px] leading-tight tracking-tight">Settings</h1>
				<p className="mt-2 text-muted-foreground text-sm">
					Account, limits and everything blaze will let you break.
				</p>
			</div>

			<section className="rounded-xl border border-border bg-card">
				<div className="border-border border-b px-7 py-5">
					<h2 className="font-medium">Account</h2>
				</div>
				<dl className="divide-y divide-border">
					<Row label="Email" value={user.email} mono />
					<Row label="Plan" value={user.plan === "free" ? "Free (alpha)" : user.plan} />
					<Row label="Member since" value={formatDate(user.createdAt)} />
					<Row label="Databases" value={`${databaseCount} of ${LIMITS.DATABASES_PER_USER}`} />
					<Row label="API keys" value={`${keys.length} of ${LIMITS.API_KEYS_PER_USER}`} />
				</dl>
				<div className="border-border border-t px-7 py-5">
					<p className="text-muted-foreground text-xs">
						Email and password are managed by Clerk — use the account menu in the top-right to
						change them.
					</p>
				</div>
			</section>

			<section className="rounded-xl border border-border bg-card">
				<div className="border-border border-b px-7 py-5">
					<h2 className="font-medium">Limits</h2>
				</div>
				<dl className="divide-y divide-border">
					<Row label="Databases per account" value={String(LIMITS.DATABASES_PER_USER)} />
					<Row label="Storage per database" value={formatBytes(LIMITS.STORAGE_BYTES)} />
					<Row label="Concurrent connections" value={`${LIMITS.CONNECTION_LIMIT} per database`} />
					<Row label="Statement timeout" value={`${LIMITS.STATEMENT_TIMEOUT_MS / 1000}s`} />
					<Row
						label="Idle in transaction"
						value={`${LIMITS.IDLE_TRANSACTION_TIMEOUT_MS / 1000}s`}
					/>
					<Row label="Longest TTL" value={`${TTL.MAX_MS / 86_400_000} days`} />
				</dl>
				<div className="border-border border-t px-7 py-5">
					<p className="text-muted-foreground text-xs">
						blaze is free and has no billing, so these limits are what keeps it running rather than
						a tier to upgrade out of. If one is blocking something real, open an issue.
					</p>
				</div>
			</section>

			<section className="rounded-xl border border-border bg-card">
				<div className="border-border border-b px-7 py-5">
					<h2 className="font-medium">Engines</h2>
				</div>
				<ul className="divide-y divide-border">
					{ENGINES.map((engine) => {
						const config = ENGINE_CONFIG[engine];
						const live = engine === "postgres";
						return (
							<li key={engine} className="flex items-center justify-between gap-4 px-7 py-4">
								<span className="flex items-center gap-3">
									<span className="text-sm">{config.label}</span>
									<span className="text-muted-foreground text-xs">
										{config.tenancy === "shared" ? "shared instance" : "dedicated container"}
									</span>
								</span>
								{live ? (
									<span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] text-success">
										<span className="size-1.5 rounded-full bg-success" />
										Available
									</span>
								) : (
									<span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
										Not yet
									</span>
								)}
							</li>
						);
					})}
				</ul>
			</section>

			<section className="rounded-xl border border-destructive/30 bg-card">
				<div className="border-destructive/30 border-b px-7 py-5">
					<h2 className="font-medium text-destructive">Danger zone</h2>
				</div>
				<div className="px-7 py-6">
					<DeleteAccount email={user.email} databaseCount={databaseCount} />
				</div>
			</section>
		</div>
	);
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="flex items-center justify-between gap-4 px-7 py-4">
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className={mono ? "truncate font-mono text-[13px]" : "text-sm"}>{value}</dd>
		</div>
	);
}

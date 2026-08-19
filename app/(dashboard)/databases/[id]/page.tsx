import { ArrowLeft, CalendarDays, Database, KeyRound, Server, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectionString } from "@/components/connection-string";
import { DeleteDatabase } from "@/components/create-database";
import { ResetPassword } from "@/components/dashboard/reset-password";
import { StatusPill } from "@/components/dashboard/status-pill";
import { requireUser } from "@/lib/auth";
import { buildConnectionString, connectionHost, connectionPort } from "@/lib/connection";
import { ENGINE_CONFIG } from "@/lib/engines/types";
import { formatBytes, formatDate, formatExpiry, percentOf } from "@/lib/format";
import { LIMITS } from "@/lib/limits";
import { getOwnedDatabase } from "@/lib/provision";

export const dynamic = "force-dynamic";

export default async function DatabaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, id);

	// getOwnedDatabase returns null for both "no such database" and "not yours", so this
	// renders the same 404 either way rather than confirming the id exists.
	if (!record) notFound();

	const target = {
		engine: record.engine,
		slug: record.slug,
		dbName: record.dbName,
		roleName: record.roleName,
		passwordEnc: record.passwordEnc,
	};
	const engine = ENGINE_CONFIG[record.engine];
	const expiry = formatExpiry(record.expiresAt);
	const usedPercent = percentOf(record.sizeBytes, LIMITS.STORAGE_BYTES);

	return (
		<div className="space-y-8">
			<div>
				<Link
					href="/databases"
					className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
				>
					<ArrowLeft className="size-3.5" />
					Databases
				</Link>
			</div>

			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="flex items-center gap-3">
						<h1 className="font-semibold text-[34px] leading-tight tracking-tight">
							{record.name}
						</h1>
						<StatusPill status={record.status} />
					</div>
					<p className="mt-3 flex flex-wrap items-center gap-4 text-muted-foreground text-sm">
						<span className="flex items-center gap-2">
							<CalendarDays className="size-4" />
							Created {formatDate(record.createdAt)}
						</span>
						<span className="flex items-center gap-2">
							<Database className="size-4" />
							{engine.label}
						</span>
						{expiry && <span className="text-warning">Auto-deletes {expiry}</span>}
					</p>
				</div>
				<DeleteDatabase id={record.id} name={record.name} redirectTo="/databases" />
			</div>

			<section className="rounded-xl border border-border bg-card p-7">
				<h2 className="mb-5 font-medium">Connection details</h2>
				<ConnectionString
					value={buildConnectionString(target, true)}
					masked={buildConnectionString(target, false)}
				/>
				<dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
					<Field label="Host" value={connectionHost(record.engine, record.slug)} mono />
					<Field label="Port" value={String(connectionPort(record.engine))} mono />
					<Field label="Database" value={record.dbName} mono />
					<Field label="Role" value={record.roleName} mono />
				</dl>
				<p className="mt-6 border-border border-t pt-5 text-muted-foreground text-xs">
					TLS is required. The password is stored encrypted and can be rotated at any time —
					existing sessions keep working until they reconnect.
				</p>
			</section>

			<div className="grid gap-6 lg:grid-cols-2">
				<section className="rounded-xl border border-border bg-card">
					<div className="flex items-center gap-3 border-border border-b px-7 py-5">
						<Server className="size-[18px] text-muted-foreground" />
						<h2 className="font-medium">Storage</h2>
					</div>
					<div className="px-7 py-6">
						<p className="font-semibold text-2xl tracking-tight">
							{formatBytes(record.sizeBytes)}
							<span className="ml-1.5 font-normal text-base text-muted-foreground">
								/ {formatBytes(LIMITS.STORAGE_BYTES)}
							</span>
						</p>
						<div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
							<div
								className={
									usedPercent > 90
										? "h-full rounded-full bg-destructive"
										: usedPercent > 70
											? "h-full rounded-full bg-warning"
											: "h-full rounded-full bg-primary"
								}
								style={{ width: `${Math.max(usedPercent, 1)}%` }}
							/>
						</div>
						<p className="mt-4 text-muted-foreground text-xs">
							Sampled every 5 minutes. Postgres has no per-database disk quota, so this sample is
							the enforcement mechanism, not just a reading.
						</p>
					</div>
				</section>

				<section className="rounded-xl border border-border bg-card">
					<div className="flex items-center gap-3 border-border border-b px-7 py-5">
						<UserRound className="size-[18px] text-muted-foreground" />
						<h2 className="font-medium">Role</h2>
					</div>
					<div className="px-7 py-6">
						<div className="flex flex-wrap items-center justify-between gap-4">
							<div className="min-w-0">
								<p className="truncate font-mono text-sm">{record.roleName}</p>
								<p className="mt-1.5 flex items-center gap-1.5 text-muted-foreground text-xs">
									<span className="size-1.5 rounded-full bg-success" />
									Has password
								</p>
							</div>
							<ResetPassword id={record.id} />
						</div>
						<p className="mt-5 text-muted-foreground text-xs">
							Owns this database and nothing else on the instance. It cannot reach another tenant's
							database, or the maintenance database — verified by
							<span className="font-mono"> scripts/smoke-provision.ts</span>.
						</p>
					</div>
				</section>
			</div>

			<section className="rounded-xl border border-border bg-card">
				<div className="flex items-center gap-3 border-border border-b px-7 py-5">
					<KeyRound className="size-[18px] text-muted-foreground" />
					<h2 className="font-medium">Limits</h2>
				</div>
				<dl className="divide-y divide-border">
					<Row label="Connections" value={`${LIMITS.CONNECTION_LIMIT} concurrent`} />
					<Row label="Statement timeout" value={`${LIMITS.STATEMENT_TIMEOUT_MS / 1000}s`} />
					<Row
						label="Idle in transaction"
						value={`${LIMITS.IDLE_TRANSACTION_TIMEOUT_MS / 1000}s`}
					/>
					<Row label="Instance" value={record.instance.internalHost} mono />
				</dl>
			</section>
		</div>
	);
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="min-w-0">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className={mono ? "mt-1 truncate font-mono text-[13px]" : "mt-1 truncate text-sm"}>
				{value}
			</dd>
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

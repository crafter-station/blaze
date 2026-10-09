import { CalendarDays, Clock, HardDrive, Lock, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EngineIcon } from "@/components/brand/engine-icon";
import { ConnectionString } from "@/components/connection-string";
import { KeyValueList, Meter, PageHeader, Panel } from "@/components/console/page";
import { DeleteDatabase } from "@/components/create-database";
import { databaseTools } from "@/components/dashboard/nav";
import { ResetPassword } from "@/components/dashboard/reset-password";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
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
		id: record.id,
		slug: record.slug,
		dbName: record.dbName,
		roleName: record.roleName,
		passwordEnc: record.passwordEnc,
	};
	const engine = ENGINE_CONFIG[record.engine];
	const expiry = formatExpiry(record.expiresAt);
	const isRedis = record.engine === "redis";
	const isMongo = record.engine === "mongo";
	// Redis keeps its data in memory, so its quota is RAM (maxmemory), not disk.
	const quota = isRedis ? LIMITS.REDIS_MEMORY_BYTES : LIMITS.STORAGE_BYTES;
	const usedPercent = percentOf(record.sizeBytes, quota);
	const tools = databaseTools(record);

	return (
		<div className="space-y-8">
			<PageHeader
				back={{ href: "/databases", label: "Databases" }}
				title={record.name}
				meta={<StatusPill status={record.status} />}
				description={
					<span className="flex flex-wrap items-center gap-x-4 gap-y-1">
						<span className="inline-flex items-center gap-1.5">
							<EngineIcon engine={record.engine} className="size-3.5" />
							{engine.label}
						</span>
						<span className="inline-flex items-center gap-1.5">
							<CalendarDays className="size-3.5" />
							Created {formatDate(record.createdAt)}
						</span>
						{expiry && (
							<span className="inline-flex items-center gap-1.5 text-warning">
								<Clock className="size-3.5" />
								{expiry === "expired" ? "TTL expired" : `Auto-deletes ${expiry}`}
							</span>
						)}
					</span>
				}
				actions={
					<>
						{tools.map((tool) => (
							<Button key={tool.href} variant="outline" size="sm" asChild>
								<Link href={tool.href}>
									<tool.icon data-icon="inline-start" />
									{tool.label}
								</Link>
							</Button>
						))}
						<DeleteDatabase
							id={record.id}
							name={record.name}
							redirectTo="/databases"
							variant="button"
						/>
					</>
				}
			/>

			<Panel
				title="Connection details"
				icon={Lock}
				footer={
					isMongo ? (
						<>
							TLS is required: the server runs <code className="text-foreground">requireTLS</code>{" "}
							and closes plaintext connections, so the string carries{" "}
							<code className="text-foreground">tls=true</code>. The certificate is currently
							self-signed, hence{" "}
							<code className="text-foreground">tlsAllowInvalidCertificates=true</code> (in mongosh:{" "}
							<code className="text-foreground">--tls --tlsAllowInvalidCertificates</code>). Keep{" "}
							<code className="text-foreground">authSource</code>: your user lives in this database,
							not in <code className="text-foreground">admin</code>.
						</>
					) : isRedis ? (
						<>
							TLS is required: the only listener is TLS, so use the{" "}
							<code className="text-foreground">rediss://</code> scheme. The certificate is
							currently self-signed, so clients that verify the chain need to skip that check (
							<code className="text-foreground">redis-cli --tls --insecure</code>, or{" "}
							<code className="text-foreground">tls: {"{ rejectUnauthorized: false }"}</code> in
							Node). The password can be rotated at any time; existing connections keep working
							until they reconnect.
						</>
					) : (
						<>
							TLS is required: the server refuses unencrypted connections. The certificate is
							currently self-signed, so clients that verify the chain need{" "}
							<code className="text-foreground">sslmode=no-verify</code> rather than{" "}
							<code className="text-foreground">require</code> (node-postgres is the common case).
							Passwords are stored encrypted and can be rotated at any time; existing sessions keep
							working until they reconnect.
						</>
					)
				}
			>
				<div className="space-y-5 p-5">
					<ConnectionString
						value={buildConnectionString(target, true)}
						masked={buildConnectionString(target, false)}
					/>
					<dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
						<Field label="Host" value={connectionHost(record.engine, record.slug, record.id)} />
						<Field label="Port" value={String(connectionPort(record.engine))} />
						{isRedis ? (
							<>
								<Field label="User" value="default" />
								<Field label="Database" value="0" />
							</>
						) : isMongo ? (
							<>
								<Field label="Database" value={record.dbName} />
								<Field label="User" value={record.roleName} />
							</>
						) : (
							<>
								<Field label="Database" value={record.dbName} />
								<Field label="Role" value={record.roleName} />
							</>
						)}
					</dl>
				</div>
			</Panel>

			<div className="grid gap-6 lg:grid-cols-2">
				<Panel
					title={isRedis ? "Memory" : "Storage"}
					icon={HardDrive}
					footer={
						isRedis
							? "Sampled every 5 minutes; the Browser shows it live. Redis enforces the limit itself: nothing is evicted, and a write that does not fit fails."
							: isMongo
								? "On-disk size (storageSize from dbStats), sampled every 5 minutes; the Browser shows it live. MongoDB has no per-database quota, so this sample is the enforcement: over the limit, the database is suspended until it is back under."
								: "Sampled every 5 minutes. Postgres has no per-database disk quota, so this sample is the enforcement mechanism, not just a reading."
					}
				>
					<div className="p-5">
						<p className="font-semibold text-[1.375rem] tabular-nums tracking-[-0.02em]">
							{formatBytes(record.sizeBytes)}
							<span className="ml-1.5 font-normal text-muted-foreground text-sm tracking-normal">
								/ {formatBytes(quota)}
							</span>
						</p>
						<Meter className="mt-4" percent={usedPercent} />
						<p className="mt-2 text-muted-foreground text-xs tabular-nums">{usedPercent}% used</p>
					</div>
				</Panel>

				<Panel
					title={isRedis || isMongo ? "User" : "Role"}
					icon={UserRound}
					footer={
						isMongo ? (
							<>
								Has <code className="text-foreground">dbOwner</code> on this database and no role
								anywhere else, so it cannot read another tenant&apos;s database or{" "}
								<code className="text-foreground">admin</code>. The Browser and Shell run as this
								user too. Verified by{" "}
								<code className="text-foreground">scripts/smoke-provision.ts</code>.
							</>
						) : isRedis ? (
							<>
								This database runs in its own container. The{" "}
								<code className="text-foreground">default</code> user can run every command on every
								key except CONFIG, ACL and REPLICAOF, so it cannot change its own memory limit or
								credentials. The console and Browser run as this user too.
							</>
						) : (
							<>
								Owns this database and nothing else on the instance. It cannot reach another
								tenant&apos;s database, or the maintenance database. Verified by{" "}
								<code className="text-foreground">scripts/smoke-provision.ts</code>.
							</>
						)
					}
				>
					<div className="flex flex-wrap items-center justify-between gap-4 p-5">
						<div className="min-w-0">
							<p className="truncate font-mono text-sm">{isRedis ? "default" : record.roleName}</p>
							<p className="mt-1.5 flex items-center gap-1.5 text-muted-foreground text-xs">
								<ShieldCheck className="size-3.5 text-success" />
								Password set, stored encrypted
							</p>
						</div>
						<ResetPassword id={record.id} />
					</div>
				</Panel>
			</div>

			<Panel
				title="Limits"
				description={
					isRedis
						? "Applied by the database's container at startup."
						: isMongo
							? "Applied by the shared MongoDB server."
							: "Applied to this database's role on the server."
				}
			>
				<KeyValueList
					items={
						isMongo
							? [
									{
										label: "Read timeout",
										value: `${LIMITS.STATEMENT_TIMEOUT_MS / 1000}s (defaultMaxTimeMS)`,
									},
									{ label: "Writes", value: "No server-side time limit" },
									{ label: "Connections", value: "No per-user limit; shared instance cap" },
									{ label: "Instance", value: record.instance.internalHost, mono: true },
								]
							: isRedis
								? [
										{ label: "Memory", value: formatBytes(LIMITS.REDIS_MEMORY_BYTES) },
										{ label: "When full", value: "Writes fail (noeviction)" },
										{ label: "Persistence", value: "Append-only file, synced every second" },
										{ label: "Container", value: record.instance.internalHost, mono: true },
									]
								: [
										{ label: "Connections", value: `${LIMITS.CONNECTION_LIMIT} concurrent` },
										{ label: "Statement timeout", value: `${LIMITS.STATEMENT_TIMEOUT_MS / 1000}s` },
										{
											label: "Idle in transaction",
											value: `${LIMITS.IDLE_TRANSACTION_TIMEOUT_MS / 1000}s`,
										},
										{ label: "Instance", value: record.instance.internalHost, mono: true },
									]
					}
				/>
			</Panel>
		</div>
	);
}

function Field({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className="mt-1 truncate font-mono text-[0.8125rem]" title={value}>
				{value}
			</dd>
		</div>
	);
}

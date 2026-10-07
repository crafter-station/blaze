import { and, count, eq, isNull } from "drizzle-orm";
import { Gauge, Layers, UserRound } from "lucide-react";
import { EngineTile } from "@/components/brand/engine-icon";
import { KeyValueList, PageHeader, Panel } from "@/components/console/page";
import { DeleteAccount } from "@/components/dashboard/delete-account";
import { Badge } from "@/components/ui/badge";
import { listApiKeys } from "@/lib/api-keys";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/control/db";
import { databases } from "@/lib/control/schema";
import { isProvisionable } from "@/lib/engines/available";
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
		<div className="max-w-3xl space-y-8">
			<PageHeader
				title="Settings"
				description="Account, limits, and the one thing here that cannot be undone."
			/>

			<Panel
				title="Account"
				icon={UserRound}
				footer="Email and password are managed by Clerk. Use the account menu in the top right to change them."
			>
				<KeyValueList
					items={[
						{ label: "Email", value: user.email, mono: true },
						{ label: "Plan", value: user.plan === "free" ? "Free (alpha)" : user.plan },
						{ label: "Member since", value: formatDate(user.createdAt) },
						{
							label: "Databases",
							value: `${databaseCount} of ${LIMITS.DATABASES_PER_USER}`,
						},
						{ label: "API keys", value: `${keys.length} of ${LIMITS.API_KEYS_PER_USER}` },
					]}
				/>
			</Panel>

			<Panel
				title="Limits"
				icon={Gauge}
				footer="blaze is free and has no billing, so these limits are what keeps it running rather than a tier to upgrade out of. If one is blocking something real, open an issue."
			>
				<KeyValueList
					items={[
						{ label: "Databases per account", value: String(LIMITS.DATABASES_PER_USER) },
						{ label: "Storage per database", value: formatBytes(LIMITS.STORAGE_BYTES) },
						{
							label: "Concurrent connections",
							value: `${LIMITS.CONNECTION_LIMIT} per database`,
						},
						{ label: "Statement timeout", value: `${LIMITS.STATEMENT_TIMEOUT_MS / 1000}s` },
						{
							label: "Idle in transaction",
							value: `${LIMITS.IDLE_TRANSACTION_TIMEOUT_MS / 1000}s`,
						},
						{ label: "Longest TTL", value: `${TTL.MAX_MS / 86_400_000} days` },
					]}
				/>
			</Panel>

			<Panel title="Engines" icon={Layers}>
				<ul className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 [&>li]:border-border sm:[&>li:nth-child(n+3)]:border-t sm:[&>li:nth-child(odd)]:border-r">
					{ENGINES.map((engine) => {
						const config = ENGINE_CONFIG[engine];
						const live = isProvisionable(engine);
						return (
							<li key={engine} className="flex items-center justify-between gap-4 px-5 py-3.5">
								<span className="flex min-w-0 items-center gap-3">
									<EngineTile engine={engine} size="sm" />
									<span className="min-w-0">
										<span className="block font-medium text-sm">{config.label}</span>
										<span className="block text-muted-foreground text-xs">
											{config.tenancy === "shared" ? "Shared instance" : "Dedicated container"}
										</span>
									</span>
								</span>
								{live ? (
									<Badge variant="success">Available</Badge>
								) : (
									<Badge variant="outline">Not yet</Badge>
								)}
							</li>
						);
					})}
				</ul>
			</Panel>

			<Panel title="Danger zone" tone="danger">
				<div className="flex flex-wrap items-center justify-between gap-4 p-5">
					<div className="max-w-md">
						<p className="font-medium text-sm">Delete account</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Drops every database you own and removes your API keys. There are no backups to
							restore from.
						</p>
					</div>
					<DeleteAccount email={user.email} databaseCount={databaseCount} />
				</div>
			</Panel>
		</div>
	);
}

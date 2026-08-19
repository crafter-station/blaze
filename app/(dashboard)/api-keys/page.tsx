import { KeyRound } from "lucide-react";
import { CreateApiKey, RevokeApiKey } from "@/components/dashboard/api-keys";
import { listApiKeys } from "@/lib/api-keys";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { LIMITS } from "@/lib/limits";

export const metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

function formatLastUsed(date: Date | null): string {
	if (!date) return "Never used";
	const ms = Date.now() - date.getTime();
	const hours = Math.round(ms / 3_600_000);
	if (hours < 1) return "Just now";
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

export default async function ApiKeysPage() {
	const user = await requireUser();
	const keys = await listApiKeys(user.id);

	return (
		<div className="space-y-8">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="font-semibold text-[34px] leading-tight tracking-tight">API keys</h1>
					<p className="mt-2 max-w-xl text-muted-foreground text-sm">
						Authenticate to the blaze API and MCP server. Keys act as you and reach every database
						you own.
					</p>
				</div>
				<CreateApiKey atLimit={keys.length >= LIMITS.API_KEYS_PER_USER} />
			</div>

			<section className="overflow-hidden rounded-xl border border-border bg-card">
				{keys.length === 0 ? (
					<div className="px-7 py-20 text-center">
						<KeyRound className="mx-auto mb-4 size-8 text-muted-foreground/50" />
						<p className="font-medium">No API keys yet</p>
						<p className="mx-auto mt-1.5 max-w-md text-muted-foreground text-sm">
							Create one to provision databases from a script, an agent, or the MCP server instead
							of this dashboard.
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[680px] text-sm">
							<thead>
								<tr className="border-border border-b text-left text-muted-foreground text-xs">
									<th className="px-7 py-3.5 font-medium">Name</th>
									<th className="px-4 py-3.5 font-medium">Key</th>
									<th className="px-4 py-3.5 font-medium">Created</th>
									<th className="px-4 py-3.5 font-medium">Last used</th>
									<th className="px-7 py-3.5" />
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{keys.map((key) => (
									<tr key={key.id} className="transition-colors hover:bg-accent/40">
										<td className="px-7 py-4">
											<span className="flex items-center gap-3">
												<span className="flex size-8 items-center justify-center rounded-lg border border-border bg-background">
													<KeyRound className="size-3.5 text-muted-foreground" />
												</span>
												<span className="font-medium">{key.name}</span>
											</span>
										</td>
										<td className="px-4 py-4 font-mono text-muted-foreground text-xs">
											{key.keyPrefix}…
										</td>
										<td className="px-4 py-4 text-muted-foreground">{formatDate(key.createdAt)}</td>
										<td className="px-4 py-4 text-muted-foreground">
											{formatLastUsed(key.lastUsedAt)}
										</td>
										<td className="px-7 py-4 text-right">
											<RevokeApiKey id={key.id} name={key.name} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="rounded-xl border border-border bg-card p-7">
				<h2 className="mb-4 font-medium">Using a key</h2>
				<pre className="overflow-x-auto rounded-lg border border-border bg-background p-4 text-[13px] text-muted-foreground">
					{`curl -X POST https://blaze.crafter.run/v1/databases \\
  -H "Authorization: Bearer blz_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"engine":"postgres","name":"my-app"}'`}
				</pre>
				<p className="mt-4 text-muted-foreground text-xs">
					The API is not live yet — keys created now will work the moment it ships.
				</p>
			</section>
		</div>
	);
}

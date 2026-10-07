import { KeyRound } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { EmptyState, PageHeader, Panel } from "@/components/console/page";
import { CreateApiKey, RevokeApiKey } from "@/components/dashboard/api-keys";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
	const atLimit = keys.length >= LIMITS.API_KEYS_PER_USER;

	return (
		<div className="space-y-8">
			<PageHeader
				title="API keys"
				description="Authenticate to the blaze API and MCP server. Keys act as you and reach every database you own."
				actions={<CreateApiKey atLimit={atLimit} />}
			/>

			<Panel>
				{keys.length === 0 ? (
					<EmptyState
						icon={KeyRound}
						title="No API keys yet"
						description="Create one to provision databases from a script, an agent, or the MCP server instead of this dashboard."
						action={<CreateApiKey atLimit={atLimit} />}
					/>
				) : (
					<Table className="md:min-w-[640px]">
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead>Name</TableHead>
								<TableHead>Key</TableHead>
								<TableHead className="hidden md:table-cell">Created</TableHead>
								<TableHead className="hidden sm:table-cell">Last used</TableHead>
								<TableHead>
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{keys.map((key) => (
								<TableRow key={key.id}>
									<TableCell>
										<span className="flex items-center gap-3">
											<span className="flex size-7 items-center justify-center rounded-md border border-border bg-background">
												<KeyRound className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
											</span>
											<span className="font-medium">{key.name}</span>
										</span>
									</TableCell>
									<TableCell className="font-mono text-[0.8125rem] text-muted-foreground">
										{key.keyPrefix}…
									</TableCell>
									<TableCell className="hidden text-muted-foreground md:table-cell">
										{formatDate(key.createdAt)}
									</TableCell>
									<TableCell className="hidden text-muted-foreground sm:table-cell">
										{formatLastUsed(key.lastUsedAt)}
									</TableCell>
									<TableCell className="text-right">
										<RevokeApiKey id={key.id} name={key.name} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</Panel>

			<Panel
				title="Using a key"
				description="Send it as a bearer token. The same key works for the REST API and the MCP server."
			>
				<div className="p-5">
					<CodeBlock
						label="Create a database"
						code={`curl -X POST https://blaze.crafter.run/v1/databases \\
  -H "Authorization: Bearer blz_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"engine":"postgres","name":"my-app"}'`}
					/>
				</div>
			</Panel>
		</div>
	);
}

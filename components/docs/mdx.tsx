import { Callout } from "fumadocs-ui/components/callout";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Terminal } from "lucide-react";
import type { MDXComponents } from "mdx/types";
import { EngineIcon } from "@/components/brand/engine-icon";
import { CopyButton } from "@/components/copy-button";
import { PROVISIONABLE } from "@/lib/engines/available";
import { ENGINE_CONFIG, ENGINES } from "@/lib/engines/types";
import { LIMITS, TTL } from "@/lib/limits";
import { MCP_URL, setupPrompt } from "@/lib/setup-prompt";

/**
 * Components available inside content/docs/*.mdx. Anything that states a number or an
 * engine's availability reads it from the code, so the docs cannot drift from it.
 */

function PromptBlock() {
	const prompt = setupPrompt();
	return (
		<div className="not-prose my-6 overflow-hidden rounded-xl border border-border bg-[var(--code-background)]">
			<div className="flex h-10 items-center justify-between gap-3 border-border border-b pr-1.5 pl-4">
				<span className="inline-flex items-center gap-2 text-muted-foreground text-xs">
					<Terminal className="size-3.5" />
					Paste into your agent
				</span>
				<CopyButton value={prompt} label="Copy prompt" />
			</div>
			<pre className="max-h-80 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[0.8125rem] leading-relaxed">
				{prompt}
			</pre>
		</div>
	);
}

function McpUrl() {
	return <code>{MCP_URL}</code>;
}

function LimitsTable() {
	const rows: [string, string][] = [
		["Databases per account", String(LIMITS.DATABASES_PER_USER)],
		["Storage per database", `${LIMITS.STORAGE_BYTES / 1024 / 1024} MB`],
		["Memory per Redis database", `${LIMITS.REDIS_MEMORY_BYTES / 1024 / 1024} MB`],
		["Concurrent connections", `${LIMITS.CONNECTION_LIMIT} per database`],
		["Statement timeout", `${LIMITS.STATEMENT_TIMEOUT_MS / 1000}s`],
		["Idle in transaction", `${LIMITS.IDLE_TRANSACTION_TIMEOUT_MS / 1000}s`],
		["Longest TTL", `${TTL.MAX_MS / 86_400_000} days`],
		["API keys", String(LIMITS.API_KEYS_PER_USER)],
	];
	return (
		<table>
			<thead>
				<tr>
					<th>Limit</th>
					<th>Value</th>
				</tr>
			</thead>
			<tbody>
				{rows.map(([label, value]) => (
					<tr key={label}>
						<td>{label}</td>
						<td>
							<code>{value}</code>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function EngineList() {
	return (
		<div className="not-prose my-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
			{ENGINES.map((engine) => {
				const live = PROVISIONABLE.includes(engine);
				return (
					<div key={engine} className="flex items-center gap-3 bg-card px-4 py-3">
						<EngineIcon engine={engine} className="size-4 text-foreground/80" />
						<span className="font-medium text-sm">{ENGINE_CONFIG[engine].label}</span>
						<span
							className={
								live ? "ml-auto text-success text-xs" : "ml-auto text-muted-foreground text-xs"
							}
						>
							{live ? "Available" : "Not yet"}
						</span>
					</div>
				);
			})}
		</div>
	);
}

function StatementTimeout() {
	return <>{LIMITS.STATEMENT_TIMEOUT_MS / 1000}s</>;
}

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		Callout,
		Tab,
		Tabs,
		Step,
		Steps,
		PromptBlock,
		McpUrl,
		LimitsTable,
		EngineList,
		StatementTimeout,
		...components,
	} satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

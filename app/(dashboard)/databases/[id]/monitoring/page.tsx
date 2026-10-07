import { Activity, TriangleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, Panel } from "@/components/console/page";
import { MetricsChart } from "@/components/dashboard/metrics-chart";
import { SampleNow } from "@/components/dashboard/sample-now";
import { StatusPill } from "@/components/dashboard/status-pill";
import { requireUser } from "@/lib/auth";
import { formatBytes } from "@/lib/format";
import { LIMITS, METRICS_INTERVAL_MS } from "@/lib/limits";
import { readHistory } from "@/lib/metrics";
import { getOwnedDatabase } from "@/lib/provision";

export const metadata = { title: "Monitoring" };
export const dynamic = "force-dynamic";

export default async function MonitoringPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, id);
	if (!record) notFound();

	const history = await readHistory(id, 24);
	const latest = history.at(-1);
	const minutes = METRICS_INTERVAL_MS / 60_000;

	return (
		<div className="space-y-8">
			<PageHeader
				back={{ href: `/databases/${id}`, label: record.name }}
				title="Monitoring"
				meta={<StatusPill status={record.status} />}
				description={`Last 24 hours, sampled every ${minutes} minutes`}
				actions={<SampleNow id={id} />}
			/>

			{record.status === "suspended" && (
				<div
					role="status"
					className="flex gap-3 rounded-xl border border-warning/30 bg-warning/[0.08] px-5 py-4"
				>
					<TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
					<div>
						<p className="font-medium text-sm text-warning">Suspended: over the storage limit</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Connections are refused but nothing has been deleted. Free space below{" "}
							{formatBytes(LIMITS.STORAGE_BYTES)} and it will be reinstated on the next sample.
						</p>
					</div>
				</div>
			)}

			{history.length === 0 ? (
				<Panel>
					<EmptyState
						icon={Activity}
						title="No samples yet"
						description={`Metrics are collected every ${minutes} minutes. Take one now to see this database's current size and connection count.`}
						action={<SampleNow id={id} />}
					/>
				</Panel>
			) : (
				<div className="grid gap-6">
					<ChartPanel
						title="Storage"
						value={latest ? formatBytes(latest.sizeBytes) : "None"}
						caption={`of ${formatBytes(LIMITS.STORAGE_BYTES)}`}
					>
						<MetricsChart data={history} metric="sizeBytes" format="bytes" />
					</ChartPanel>

					<div className="grid gap-6 lg:grid-cols-2">
						<ChartPanel
							title="Connections"
							value={latest ? String(latest.connections) : "None"}
							caption={`of ${LIMITS.CONNECTION_LIMIT} allowed`}
						>
							<MetricsChart data={history} metric="connections" format="count" />
						</ChartPanel>

						<ChartPanel
							title="Transactions"
							value={latest?.commits !== null && latest ? String(latest.commits) : "None"}
							caption="commits since previous sample"
						>
							<MetricsChart data={history} metric="commits" format="count" />
						</ChartPanel>
					</div>
				</div>
			)}

			<p className="max-w-2xl text-muted-foreground text-xs leading-relaxed">
				Figures come from the engine&apos;s own statistics, not the container. A shared instance
				serves many tenants, so its CPU and memory would say nothing about this database.
			</p>
		</div>
	);
}

function ChartPanel({
	title,
	value,
	caption,
	children,
}: {
	title: string;
	value: string;
	caption: string;
	children: React.ReactNode;
}) {
	return (
		<section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
			<div className="px-5 pt-4">
				<h2 className="text-[0.8125rem] text-muted-foreground">{title}</h2>
				<p className="mt-1 font-semibold text-[1.375rem] tabular-nums tracking-[-0.02em]">
					{value}
					<span className="ml-1.5 font-normal text-muted-foreground text-sm tracking-normal">
						{caption}
					</span>
				</p>
			</div>
			<div className="px-2 pt-3 pb-3">{children}</div>
		</section>
	);
}

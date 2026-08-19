import { Activity } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MetricsChart } from "@/components/dashboard/metrics-chart";
import { SampleNow } from "@/components/dashboard/sample-now";
import { StatusPill } from "@/components/dashboard/status-pill";
import { requireUser } from "@/lib/auth";
import { formatBytes } from "@/lib/format";
import { LIMITS, METRICS_INTERVAL_MS } from "@/lib/limits";
import { readHistory } from "@/lib/metrics";
import { getOwnedDatabase } from "@/lib/provision";

export const dynamic = "force-dynamic";

export default async function MonitoringPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await requireUser();
	const record = await getOwnedDatabase(user.id, id);
	if (!record) notFound();

	const history = await readHistory(id, 24);
	const latest = history.at(-1);

	return (
		<div className="space-y-8">
			<div>
				<Link
					href={`/databases/${id}`}
					className="text-muted-foreground text-sm transition-colors hover:text-foreground"
				>
					← {record.name}
				</Link>
			</div>

			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="flex items-center gap-3">
						<h1 className="font-semibold text-[42px] leading-tight tracking-tight">Monitoring</h1>
						<StatusPill status={record.status} />
					</div>
					<p className="mt-2 text-muted-foreground text-sm">
						Last 24 hours · sampled every {METRICS_INTERVAL_MS / 60_000} minutes
					</p>
				</div>
				<SampleNow id={id} />
			</div>

			{record.status === "suspended" && (
				<div className="rounded-xl border border-warning/30 bg-warning/10 px-7 py-5">
					<p className="font-medium text-sm text-warning">Suspended — over the storage limit</p>
					<p className="mt-1.5 text-muted-foreground text-sm">
						Connections are refused but nothing has been deleted. Free space below{" "}
						{formatBytes(LIMITS.STORAGE_BYTES)} and it will be reinstated on the next sample.
					</p>
				</div>
			)}

			{history.length === 0 ? (
				<section className="rounded-xl border border-border bg-card px-7 py-20 text-center">
					<Activity className="mx-auto mb-4 size-8 text-muted-foreground/50" />
					<p className="font-medium">No samples yet</p>
					<p className="mx-auto mt-1.5 max-w-md text-muted-foreground text-sm">
						Metrics are collected every {METRICS_INTERVAL_MS / 60_000} minutes. Take one now to see
						this database's current size and connection count.
					</p>
				</section>
			) : (
				<div className="space-y-6">
					<Panel
						title="Storage"
						value={latest ? formatBytes(latest.sizeBytes) : "—"}
						caption={`of ${formatBytes(LIMITS.STORAGE_BYTES)}`}
					>
						<MetricsChart data={history} metric="sizeBytes" format={formatBytes} />
					</Panel>

					<Panel
						title="Connections"
						value={latest ? String(latest.connections) : "—"}
						caption={`of ${LIMITS.CONNECTION_LIMIT} allowed`}
					>
						<MetricsChart
							data={history}
							metric="connections"
							format={(v) => String(Math.round(v))}
						/>
					</Panel>

					<Panel
						title="Transactions"
						value={latest?.commits !== null && latest ? String(latest.commits) : "—"}
						caption="commits since previous sample"
					>
						<MetricsChart data={history} metric="commits" format={(v) => String(Math.round(v))} />
					</Panel>
				</div>
			)}

			<p className="text-muted-foreground text-xs">
				Figures come from the engine's own statistics, not the container — a shared instance serves
				many tenants, so its CPU and memory would say nothing about this database.
			</p>
		</div>
	);
}

function Panel({
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
		<section className="rounded-xl border border-border bg-card">
			<div className="flex flex-wrap items-baseline justify-between gap-3 border-border border-b px-7 py-5">
				<h2 className="font-medium">{title}</h2>
				<p className="font-semibold text-2xl tracking-tight">
					{value}
					<span className="ml-1.5 font-normal text-muted-foreground text-sm">{caption}</span>
				</p>
			</div>
			<div className="px-4 py-6">{children}</div>
		</section>
	);
}

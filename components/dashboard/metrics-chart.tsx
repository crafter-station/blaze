"use client";

import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	type TooltipContentProps,
	XAxis,
	YAxis,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { formatBytes } from "@/lib/format";
import type { MetricPoint } from "@/lib/metrics";

/**
 * One metric over time.
 *
 * The series is drawn in the brand colour: "primary chart series" is one of the four jobs
 * the accent is allowed, and each chart carries exactly one series. Every other part of
 * the chart (grid, axes, tooltip) reads from the neutral tokens, so it follows light and
 * dark mode without a second configuration.
 *
 * `format` is a name, not a function. Functions cannot cross the Server -> Client
 * component boundary, and passing one here threw a server error that only appeared once
 * real samples existed.
 */

type Formatter = "bytes" | "count";

interface Props {
	data: MetricPoint[];
	metric: "sizeBytes" | "connections" | "commits";
	format: Formatter;
}

const FORMATTERS: Record<Formatter, (value: number) => string> = {
	bytes: formatBytes,
	count: (value) => String(Math.round(value)),
};

function formatTime(iso: string): string {
	return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function MetricsChart({ data, metric, format }: Props) {
	const formatValue = FORMATTERS[format];

	// Gaps are meaningful: a null commit delta means the server restarted between samples,
	// and connecting across it would draw a trend that never happened.
	const points = data.map((point) => ({ ts: point.ts, value: point[metric] }));

	return (
		<ResponsiveContainer width="100%" height={208}>
			<AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
				<defs>
					<linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
						<stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
					</linearGradient>
				</defs>
				<CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
				<XAxis
					dataKey="ts"
					tickFormatter={formatTime}
					stroke="var(--muted-foreground)"
					fontSize={11}
					tickLine={false}
					axisLine={false}
					minTickGap={48}
					tickMargin={8}
				/>
				<YAxis
					tickFormatter={formatValue}
					stroke="var(--muted-foreground)"
					fontSize={11}
					tickLine={false}
					axisLine={false}
					width={68}
				/>
				<Tooltip
					cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
					content={(props) => <ChartTooltip {...props} formatValue={formatValue} />}
				/>
				<Area
					type="monotone"
					dataKey="value"
					stroke="var(--chart-1)"
					strokeWidth={1.75}
					fill={`url(#fill-${metric})`}
					connectNulls={false}
					dot={false}
					activeDot={{ r: 3.5, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
					isAnimationActive={false}
				/>
			</AreaChart>
		</ResponsiveContainer>
	);
}

function ChartTooltip({
	active,
	payload,
	label,
	formatValue,
}: TooltipContentProps<ValueType, NameType> & { formatValue: (value: number) => string }) {
	if (!active || !payload?.length) return null;
	const value = payload[0]?.value;
	return (
		<div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg">
			<p className="text-muted-foreground">{new Date(String(label)).toLocaleString()}</p>
			<p className="mt-1 flex items-center gap-1.5 font-medium tabular-nums">
				<span className="size-1.5 rounded-full bg-brand" />
				{value === null || value === undefined ? "No data" : formatValue(Number(value))}
			</p>
		</div>
	);
}

"use client";

import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { MetricPoint } from "@/lib/metrics";

/**
 * One metric over time.
 *
 * The palette is grayscale by design (see globals.css) — series are told apart by which
 * chart they are in and what the axis says, not by hue. With a single series per chart
 * there is nothing for colour to disambiguate, so spending it here would only weaken the
 * one place colour still means something: status.
 */

interface Props {
	data: MetricPoint[];
	metric: "sizeBytes" | "connections" | "commits";
	format: (value: number) => string;
}

function formatTime(iso: string): string {
	return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function MetricsChart({ data, metric, format }: Props) {
	// Gaps are meaningful: a null commit delta means the server restarted between samples,
	// and connecting across it would draw a trend that never happened.
	const points = data.map((point) => ({
		ts: point.ts,
		value: point[metric],
	}));

	return (
		<ResponsiveContainer width="100%" height={200}>
			<AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
				<defs>
					<linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
						<stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
					</linearGradient>
				</defs>
				<CartesianGrid stroke="var(--border)" vertical={false} />
				<XAxis
					dataKey="ts"
					tickFormatter={formatTime}
					stroke="var(--muted-foreground)"
					fontSize={11}
					tickLine={false}
					axisLine={false}
					minTickGap={40}
				/>
				<YAxis
					tickFormatter={format}
					stroke="var(--muted-foreground)"
					fontSize={11}
					tickLine={false}
					axisLine={false}
					width={60}
				/>
				<Tooltip
					contentStyle={{
						background: "var(--popover)",
						border: "1px solid var(--border)",
						borderRadius: "var(--radius)",
						fontSize: 12,
					}}
					labelFormatter={(value) => new Date(String(value)).toLocaleString()}
					formatter={(value) => [format(Number(value)), ""]}
				/>
				<Area
					type="monotone"
					dataKey="value"
					stroke="var(--chart-1)"
					strokeWidth={1.5}
					fill={`url(#fill-${metric})`}
					connectNulls={false}
					dot={false}
					isAnimationActive={false}
				/>
			</AreaChart>
		</ResponsiveContainer>
	);
}

import { ArrowLeft, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Page scaffolding for the console. Every page uses these instead of hand-rolling its
 * own header and card chrome, so spacing and type stay on one scale:
 *
 *   page title   24px / semibold / -0.02em
 *   panel title  15px / medium
 *   body         14px, secondary text 13px, captions 12px
 *   rhythm       32px between page blocks, 20px inside panels
 */

export function PageHeader({
	title,
	description,
	actions,
	meta,
	back,
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	actions?: React.ReactNode;
	/** Inline items beside the title, e.g. a status pill. */
	meta?: React.ReactNode;
	back?: { href: string; label: string };
}) {
	return (
		<header className="flex flex-col gap-4">
			{back && (
				<Link
					href={back.href}
					className="inline-flex w-fit items-center gap-1.5 rounded-sm text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
				>
					<ArrowLeft className="size-3.5" />
					{back.label}
				</Link>
			)}
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-3">
						<h1 className="truncate font-semibold text-2xl tracking-[-0.02em]">{title}</h1>
						{meta}
					</div>
					{description && (
						<div className="mt-1.5 max-w-2xl text-muted-foreground text-sm">{description}</div>
					)}
				</div>
				{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
			</div>
		</header>
	);
}

/** A titled surface. The workhorse container of the console. */
export function Panel({
	title,
	description,
	icon: Icon,
	action,
	children,
	footer,
	className,
	bodyClassName,
	tone = "default",
}: {
	title?: React.ReactNode;
	description?: React.ReactNode;
	icon?: LucideIcon;
	action?: React.ReactNode;
	children?: React.ReactNode;
	footer?: React.ReactNode;
	className?: string;
	bodyClassName?: string;
	tone?: "default" | "danger";
}) {
	return (
		<section
			className={cn(
				"overflow-hidden rounded-xl border bg-card shadow-xs",
				tone === "danger" ? "border-destructive/30" : "border-border",
				className,
			)}
		>
			{title && (
				<div
					className={cn(
						"flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5",
						tone === "danger" ? "border-destructive/20" : "border-border",
					)}
				>
					<div className="flex min-w-0 items-center gap-2.5">
						{Icon && <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />}
						<div className="min-w-0">
							<h2
								className={cn(
									"font-medium text-[0.9375rem] tracking-[-0.01em]",
									tone === "danger" && "text-destructive",
								)}
							>
								{title}
							</h2>
							{description && (
								<p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{description}</p>
							)}
						</div>
					</div>
					{action}
				</div>
			)}
			{children !== undefined && <div className={bodyClassName}>{children}</div>}
			{footer && (
				<div className="border-border border-t bg-muted/30 px-5 py-3 text-muted-foreground text-xs leading-relaxed">
					{footer}
				</div>
			)}
		</section>
	);
}

/** Composed "nothing here yet" state: what is missing, why, and the way forward. */
export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	className,
}: {
	icon: LucideIcon;
	title: string;
	description?: React.ReactNode;
	action?: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
			<div className="relative mb-5">
				<div className="absolute -inset-4 rounded-full bg-[radial-gradient(closest-side,var(--brand-soft),transparent)]" />
				<span className="relative flex size-11 items-center justify-center rounded-xl border border-border bg-background shadow-xs">
					<Icon className="size-5 text-muted-foreground" strokeWidth={1.5} />
				</span>
			</div>
			<p className="font-medium text-[0.9375rem]">{title}</p>
			{description && (
				<p className="mt-1.5 max-w-sm text-balance text-muted-foreground text-sm leading-relaxed">
					{description}
				</p>
			)}
			{action && <div className="mt-5">{action}</div>}
		</div>
	);
}

/** Label / value rows, one per line, hairline between. */
export function KeyValueList({
	items,
	className,
}: {
	items: { label: string; value: React.ReactNode; mono?: boolean }[];
	className?: string;
}) {
	return (
		<dl className={cn("divide-y divide-border", className)}>
			{items.map((item) => (
				<div key={item.label} className="flex items-center justify-between gap-6 px-5 py-3">
					<dt className="shrink-0 text-muted-foreground text-sm">{item.label}</dt>
					<dd
						className={cn(
							"min-w-0 truncate text-right text-sm",
							item.mono && "font-mono text-[0.8125rem]",
						)}
					>
						{item.value}
					</dd>
				</div>
			))}
		</dl>
	);
}

/** A headline number with its limit, for usage summaries. */
export function Stat({
	label,
	value,
	limit,
	children,
}: {
	label: string;
	value: string;
	limit?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="min-w-0">
			<p className="text-[0.8125rem] text-muted-foreground">{label}</p>
			<p className="mt-1.5 truncate font-semibold text-[1.375rem] tabular-nums tracking-[-0.02em]">
				{value}
				{limit && (
					<span className="ml-1.5 font-normal text-muted-foreground text-sm tracking-normal">
						{limit}
					</span>
				)}
			</p>
			{children}
		</div>
	);
}

/** Thin quota meter. Colour shifts only as it approaches the limit. */
export function Meter({ percent, className }: { percent: number; className?: string }) {
	const tone = percent > 90 ? "bg-destructive" : percent > 70 ? "bg-warning" : "bg-foreground/70";
	return (
		<div
			className={cn("h-1 overflow-hidden rounded-full bg-foreground/[0.07]", className)}
			// Decorative: every meter sits beside the figure it draws, which is what gets read.
			aria-hidden="true"
		>
			<div
				className={cn("h-full rounded-full transition-[width] duration-500", tone)}
				style={{ width: `${Math.max(percent, 1.5)}%` }}
			/>
		</div>
	);
}

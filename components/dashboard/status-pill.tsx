import { cn } from "@/lib/utils";

type Status = "provisioning" | "active" | "suspended" | "deleting" | "failed";

/**
 * Status colours are assigned by what the user can do about it: green needs nothing,
 * amber is recoverable and usually theirs to fix (over quota), red needs us. Transient
 * states are neutral and pulse, so "provisioning" reads as in-flight rather than settled.
 */
const STYLES: Record<Status, { wrap: string; dot: string; pulse: boolean }> = {
	active: {
		wrap: "text-success border-success/20 bg-success/[0.08]",
		dot: "bg-success",
		pulse: false,
	},
	provisioning: {
		wrap: "text-muted-foreground border-border bg-muted",
		dot: "bg-muted-foreground",
		pulse: true,
	},
	deleting: {
		wrap: "text-muted-foreground border-border bg-muted",
		dot: "bg-muted-foreground",
		pulse: true,
	},
	suspended: {
		wrap: "text-warning border-warning/25 bg-warning/[0.08]",
		dot: "bg-warning",
		pulse: false,
	},
	failed: {
		wrap: "text-destructive border-destructive/25 bg-destructive/[0.08]",
		dot: "bg-destructive",
		pulse: false,
	},
};

const LABELS: Record<Status, string> = {
	active: "Active",
	provisioning: "Provisioning",
	deleting: "Deleting",
	suspended: "Suspended",
	failed: "Failed",
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
	const style = STYLES[status];

	return (
		<span
			className={cn(
				"inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm border px-1.5 font-medium text-[0.6875rem] leading-none",
				style.wrap,
				className,
			)}
		>
			<span className="relative flex size-1.5">
				{style.pulse && (
					<span
						className={cn(
							"absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none",
							style.dot,
						)}
					/>
				)}
				<span className={cn("relative inline-flex size-full rounded-full", style.dot)} />
			</span>
			{LABELS[status]}
		</span>
	);
}

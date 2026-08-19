import { cn } from "@/lib/utils";

type Status = "provisioning" | "active" | "suspended" | "deleting" | "failed";

/**
 * Status colours are assigned by what the user can do about it: green needs nothing,
 * amber is recoverable and usually theirs to fix (over quota), red needs us. Transient
 * states are neutral and animate, so "provisioning" reads as in-flight rather than as a
 * state that has settled.
 *
 * In a monochrome palette these badges are close to the only saturated thing on screen,
 * which is the point — state should be the first thing the eye finds.
 */
const STYLES: Record<Status, { wrap: string; dot: string; pulse: boolean }> = {
	active: {
		wrap: "border-success/25 bg-success/10 text-success",
		dot: "bg-success",
		pulse: false,
	},
	provisioning: {
		wrap: "border-border bg-muted text-muted-foreground",
		dot: "bg-muted-foreground",
		pulse: true,
	},
	deleting: {
		wrap: "border-border bg-muted text-muted-foreground",
		dot: "bg-muted-foreground",
		pulse: true,
	},
	suspended: {
		wrap: "border-warning/25 bg-warning/10 text-warning",
		dot: "bg-warning",
		pulse: false,
	},
	failed: {
		wrap: "border-destructive/25 bg-destructive/10 text-destructive",
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

export function StatusPill({ status }: { status: Status }) {
	const style = STYLES[status];

	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-2 font-medium text-[11px] leading-none",
				style.wrap,
			)}
		>
			{/* Two stacked dots: a soft halo behind a solid core, so the indicator reads at
			    11px without needing a larger badge. */}
			<span className="relative flex size-1.5 items-center justify-center">
				<span
					className={cn(
						"absolute inline-flex size-full rounded-full opacity-60",
						style.dot,
						style.pulse && "animate-ping",
					)}
				/>
				<span className={cn("relative inline-flex size-full rounded-full", style.dot)} />
			</span>
			{LABELS[status]}
		</span>
	);
}

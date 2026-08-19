import { cn } from "@/lib/utils";

type Status = "provisioning" | "active" | "suspended" | "deleting" | "failed";

/**
 * Status colours carry meaning, so they are assigned by what the user can do about it:
 * green needs nothing, amber is recoverable and usually theirs to fix (over quota), red
 * needs us. Provisioning and deleting are transient and read as neutral.
 */
const STYLES: Record<Status, string> = {
	active: "border-success/30 bg-success/10 text-success",
	provisioning: "border-border bg-muted text-muted-foreground",
	deleting: "border-border bg-muted text-muted-foreground",
	suspended: "border-warning/30 bg-warning/10 text-warning",
	failed: "border-destructive/30 bg-destructive/10 text-destructive",
};

const LABELS: Record<Status, string> = {
	active: "Active",
	provisioning: "Provisioning",
	deleting: "Deleting",
	suspended: "Suspended",
	failed: "Failed",
};

export function StatusPill({ status }: { status: Status }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
				STYLES[status],
			)}
		>
			<span className="size-1.5 rounded-full bg-current" />
			{LABELS[status]}
		</span>
	);
}

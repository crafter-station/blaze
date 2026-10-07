import { cn } from "cn";

/** Placeholder block. Sized by the caller to match the content it stands in for. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			aria-hidden="true"
			className={cn(
				"animate-pulse rounded-md bg-foreground/[0.06] motion-reduce:animate-none",
				className,
			)}
			{...props}
		/>
	);
}

export { Skeleton };

import { cn } from "cn";
import type * as React from "react";

/** Recessed well: one step darker than the card it sits on, focus ring in brand. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1 text-base shadow-xs transition-[border-color,box-shadow] duration-150 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };

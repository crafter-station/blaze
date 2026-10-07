import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import type * as React from "react";

/**
 * Buttons. `default` is the one amber action per surface; everything else is neutral.
 * Pressed state nudges down 1px rather than scaling, so text never blurs mid-press.
 */
const buttonVariants = cva(
	"group/button relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-(--ease-snappy) outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/35 focus-visible:border-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_1px_2px_var(--shadow-color)] hover:bg-[color-mix(in_oklab,var(--primary),white_8%)]",
				outline:
					"border-border bg-card text-foreground shadow-xs hover:border-border-strong hover:bg-accent aria-expanded:bg-accent",
				secondary: "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent",
				ghost:
					"text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
				destructive:
					"bg-destructive text-white shadow-xs hover:bg-[color-mix(in_oklab,var(--destructive),black_8%)] focus-visible:border-destructive focus-visible:ring-destructive/30 dark:text-[#1a0405]",
				"destructive-outline":
					"border-border bg-card text-destructive shadow-xs hover:border-destructive/40 hover:bg-destructive/10 focus-visible:border-destructive focus-visible:ring-destructive/25",
				link: "h-auto px-0 text-brand-text underline-offset-4 hover:underline",
			},
			size: {
				default:
					"h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
				xs: "h-6 gap-1 rounded-sm px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-7 gap-1 px-2.5 text-[0.8125rem] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-9 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
				xl: "h-11 gap-2 rounded-lg px-5 text-[0.9375rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
				icon: "size-8",
				"icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
				"icon-lg": "size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };

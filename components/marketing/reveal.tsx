"use client";

import { motion, useReducedMotion } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Fade-up on first entry into the viewport. Used to sequence the landing page as it is
 * read, not to decorate it; under prefers-reduced-motion content is simply there.
 */
export function Reveal({
	children,
	delay = 0,
	className,
	as = "div",
}: {
	children: React.ReactNode;
	delay?: number;
	className?: string;
	as?: "div" | "li" | "section";
}) {
	const reduce = useReducedMotion();
	const Component = motion[as];
	return (
		<Component
			className={className}
			initial={reduce ? false : { opacity: 0, y: 18 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, amount: 0.25 }}
			transition={{ duration: 0.7, delay, ease: EASE }}
		>
			{children}
		</Component>
	);
}

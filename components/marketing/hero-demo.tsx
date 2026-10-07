"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The hero's proof: one sentence to an agent in, one connection string out.
 *
 * Every value is the documented example from /docs (same name, host, port, TTL), so the
 * demo never claims more than the MCP server returns. It types once and stops; there is
 * no loop and no replay. Every line is laid out from the first paint and only revealed,
 * so the typing never shifts the page. Under prefers-reduced-motion it renders the
 * finished state.
 */

const PROMPT = "Create a Postgres database for my-app and delete it tomorrow.";
const CALL = `create_database { "name": "my-app", "engine": "postgres", "ttl_seconds": 86400 }`;
const CONNECTION =
	"postgresql://u_my_app_q647:••••••••@pg.blaze.crafter.run:5433/db_my_app_x4k2?sslmode=require";
const NOTE = "Ready. It auto-deletes in 24 hours.";

const CHAR_MS = 28;
const START_MS = 500;

export function HeroDemo() {
	// -1 until mounted, so the server HTML and the first client render agree.
	const [typed, setTyped] = useState(-1);
	// 0 typing, 1 tool call shown, 2 result shown
	const [step, setStep] = useState(0);

	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setTyped(PROMPT.length);
			setStep(2);
			return;
		}
		setTyped(0);
		const timers: ReturnType<typeof setTimeout>[] = [];
		let typer: ReturnType<typeof setInterval> | undefined;
		timers.push(
			setTimeout(() => {
				let index = 0;
				typer = setInterval(() => {
					index += 1;
					setTyped(index);
					if (index >= PROMPT.length) {
						clearInterval(typer);
						timers.push(setTimeout(() => setStep(1), 350));
						timers.push(setTimeout(() => setStep(2), 1100));
					}
				}, CHAR_MS);
			}, START_MS),
		);
		return () => {
			clearInterval(typer);
			for (const timer of timers) clearTimeout(timer);
		};
	}, []);

	const shown = Math.max(typed, 0);
	const typing = step === 0;

	return (
		<figure className="min-w-0">
			<figcaption className="sr-only">
				Example: asking an agent for a database through the blaze MCP server. You: {PROMPT} The
				agent calls create_database and gets back {CONNECTION}. {NOTE}
			</figcaption>
			<div
				aria-hidden="true"
				translate="no"
				className="rounded-lg bg-[var(--code-background)] px-5 py-5 font-mono text-[0.75rem] leading-[1.7] ring-1 ring-border ring-inset sm:px-6 sm:py-6 sm:text-[0.8125rem]"
			>
				<p className="text-foreground">
					<span className="mr-2 select-none text-muted-foreground">&gt;</span>
					{PROMPT.slice(0, shown)}
					{typing && (
						<span className="-mr-[0.6ch] ml-px inline-block h-[1.15em] w-[0.6ch] translate-y-[0.2em] bg-foreground/70 motion-safe:animate-pulse" />
					)}
					<span className="text-transparent">{PROMPT.slice(shown)}</span>
				</p>

				<div
					className={cn(
						"mt-5 transition-opacity duration-300",
						step >= 1 ? "opacity-100" : "opacity-0",
					)}
				>
					<p className="break-words text-muted-foreground">{CALL}</p>
				</div>

				<div
					className={cn(
						"mt-5 transition-opacity duration-500",
						step >= 2 ? "opacity-100" : "opacity-0",
					)}
				>
					{/* Prefer breaking after the credentials and after the port; split mid-word only
					    when a segment still does not fit. */}
					<p className="text-foreground [overflow-wrap:anywhere]">
						{CONNECTION.split(/(?<=[@/](?=[a-z]))/).map((part) => (
							<span key={part}>
								{part}
								<wbr />
							</span>
						))}
					</p>
					<p className="mt-1 text-muted-foreground">{NOTE}</p>
				</div>
			</div>
		</figure>
	);
}

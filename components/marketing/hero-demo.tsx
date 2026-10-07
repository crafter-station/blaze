"use client";

import { Check, Loader2, RotateCcw } from "lucide-react";
import {
	AnimatePresence,
	animate,
	motion,
	useInView,
	useMotionValue,
	useReducedMotion,
	useTransform,
} from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The hero's proof: one request in, one connection string out.
 *
 * Every value shown is the documented example from /docs (same name, host, port and
 * response fields, same `took_ms`), so the demo never claims more than the API returns.
 * It plays once when scrolled into view and offers a replay rather than looping, so it
 * does not compete with the copy beside it. Under prefers-reduced-motion it renders the
 * finished state.
 */

type Mode = "mcp" | "api";

const TOOK_MS = 286;
const CONNECTION =
	"postgresql://u_my_app_q647:••••••••@pg.blaze.crafter.run:5433/db_my_app_x4k2?sslmode=require";

const SCRIPT: Record<Mode, { prompt: string; call: string[] }> = {
	mcp: {
		prompt: "Create a Postgres database for my-app and delete it tomorrow.",
		call: [
			"blaze · create_database",
			`{ "name": "my-app", "engine": "postgres", "ttl_seconds": 86400 }`,
		],
	},
	api: {
		prompt: `curl -X POST https://blaze.crafter.run/v1/databases \\
  -H "Authorization: Bearer $BLAZE_KEY" \\
  -d '{"name":"my-app","ttl_seconds":86400}'`,
		call: ["POST /v1/databases", "201 Created"],
	},
};

const EASE = [0.16, 1, 0.3, 1] as const;

export function HeroDemo() {
	const reduce = useReducedMotion();
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { once: true, amount: 0.4 });

	const [mode, setMode] = useState<Mode>("mcp");
	// 0 typing, 1 call sent, 2 provisioning, 3 ready
	const [step, setStep] = useState(0);
	const [typed, setTyped] = useState(0);
	const [run, setRun] = useState(0);

	const elapsed = useMotionValue(0);
	const elapsedText = useTransform(elapsed, (value) => `${Math.round(value)}ms`);

	const script = SCRIPT[mode];

	const finish = useCallback(() => {
		setTyped(script.prompt.length);
		elapsed.set(TOOK_MS);
		setStep(3);
	}, [script.prompt.length, elapsed]);

	useEffect(() => {
		if (!inView) return;
		if (reduce) {
			finish();
			return;
		}
		// `run` restarts the sequence on replay and on tab change.
		void run;
		setStep(0);
		setTyped(0);
		elapsed.set(0);

		const timers: ReturnType<typeof setTimeout>[] = [];
		const perChar = mode === "mcp" ? 22 : 9;
		let index = 0;
		const typer = setInterval(() => {
			index += 1;
			setTyped(index);
			if (index >= script.prompt.length) {
				clearInterval(typer);
				timers.push(setTimeout(() => setStep(1), 260));
				timers.push(
					setTimeout(() => {
						setStep(2);
						animate(elapsed, TOOK_MS, { duration: 0.9, ease: "easeOut" });
					}, 760),
				);
				timers.push(setTimeout(() => setStep(3), 1760));
			}
		}, perChar);

		return () => {
			clearInterval(typer);
			for (const timer of timers) clearTimeout(timer);
		};
	}, [inView, reduce, mode, run, script.prompt.length, elapsed, finish]);

	return (
		<div ref={ref} className="relative">
			{/* Ambient brand glow behind the panel; the only gradient on the page. */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(60%_50%_at_70%_40%,var(--brand-soft),transparent)] blur-2xl"
			/>
			<div className="rounded-2xl border border-border bg-foreground/[0.025] p-1.5 shadow-lg">
				<div className="overflow-hidden rounded-[calc(1rem-0.375rem)] border border-border bg-card shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
					<div className="flex items-center justify-between gap-3 border-border border-b px-3 py-2">
						<div role="tablist" aria-label="Provision with" className="flex items-center gap-1">
							{(["mcp", "api"] as const).map((value) => (
								<button
									key={value}
									type="button"
									role="tab"
									aria-selected={mode === value}
									onClick={() => {
										setMode(value);
										setRun((n) => n + 1);
									}}
									className={cn(
										"rounded-md px-2.5 py-1 font-medium text-xs transition-colors",
										mode === value
											? "bg-accent text-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{value === "mcp" ? "MCP · agent" : "REST API"}
								</button>
							))}
						</div>
						<StatusChip step={step} elapsedText={elapsedText} />
					</div>

					<div className="min-h-[300px] space-y-4 p-4 font-mono text-[0.75rem] leading-relaxed sm:p-5 sm:text-[0.8125rem]">
						<div className="flex gap-3">
							<span className="w-9 shrink-0 select-none text-muted-foreground">
								{mode === "mcp" ? "you" : "$"}
							</span>
							<p className="min-w-0 whitespace-pre-wrap break-words text-foreground">
								{script.prompt.slice(0, typed)}
								{step === 0 && (
									<span className="ml-px inline-block h-[1.1em] w-[0.55ch] translate-y-[0.2em] animate-pulse bg-brand motion-reduce:animate-none" />
								)}
							</p>
						</div>

						<AnimatePresence>
							{step >= 1 && (
								<motion.div
									key={`call-${mode}`}
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.4, ease: EASE }}
									className="flex gap-3"
								>
									<span className="w-9 shrink-0 select-none text-muted-foreground">
										{mode === "mcp" ? "tool" : "→"}
									</span>
									<div className="min-w-0 rounded-md border border-border bg-background px-3 py-2">
										<p className="text-muted-foreground">{script.call[0]}</p>
										<p className="mt-1 break-all text-foreground/80">{script.call[1]}</p>
									</div>
								</motion.div>
							)}
						</AnimatePresence>

						<AnimatePresence>
							{step >= 3 && (
								<motion.div
									key={`result-${mode}`}
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.5, ease: EASE }}
									className="flex gap-3"
								>
									<span className="w-9 shrink-0 select-none text-success">ok</span>
									<div className="min-w-0 space-y-1.5">
										{mode === "api" && (
											<p className="text-muted-foreground">
												{`{ "id": "db_c28u7dyz23fc", "status": "active", "took_ms": ${TOOK_MS},`}
											</p>
										)}
										<p className="rounded-md bg-brand-soft px-2 py-1.5 break-all text-foreground">
											{mode === "api" ? `"connection_string": "${CONNECTION}"` : CONNECTION}
										</p>
										<p className="text-muted-foreground">
											{mode === "api"
												? `"expires_at": "2026-08-20T20:28:12.171Z" }`
												: "Ready. It auto-deletes in 24 hours."}
										</p>
									</div>
								</motion.div>
							)}
						</AnimatePresence>
					</div>

					<div className="flex items-center justify-between border-border border-t px-4 py-2 text-[0.6875rem] text-muted-foreground">
						<span>Documented example values</span>
						<button
							type="button"
							onClick={() => setRun((n) => n + 1)}
							disabled={step < 3}
							className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground disabled:opacity-0"
						>
							<RotateCcw className="size-3" />
							Replay
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function StatusChip({
	step,
	elapsedText,
}: {
	step: number;
	elapsedText: ReturnType<typeof useTransform<number, string>>;
}) {
	const ready = step >= 3;
	const busy = step === 2;
	return (
		<span
			className={cn(
				"inline-flex h-6 items-center gap-1.5 rounded-full border px-2 font-mono text-[0.6875rem] tabular-nums transition-colors",
				ready
					? "border-success/25 bg-success/10 text-success"
					: "border-border text-muted-foreground",
			)}
		>
			{ready ? (
				<Check className="size-3" />
			) : busy ? (
				<Loader2 className="size-3 animate-spin" />
			) : (
				<span className="size-1.5 rounded-full bg-muted-foreground/60" />
			)}
			{step < 2 ? "idle" : <motion.span>{elapsedText}</motion.span>}
		</span>
	);
}

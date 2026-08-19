import { UserButton } from "@clerk/nextjs";
import { CircleHelp } from "lucide-react";
import Link from "next/link";

/**
 * Top bar in Neon's shape: brand tile, workspace scope with plan pill, then health,
 * help and account on the right.
 *
 * The status pill is real — it reflects the control plane, not a decoration. A console
 * that always says "All OK" teaches people to stop reading it.
 */
export function TopBar({
	workspace,
	plan,
	healthy,
}: {
	workspace: string;
	plan: string;
	healthy: boolean;
}) {
	return (
		<header className="sticky top-0 z-20 border-border border-b bg-background/85 backdrop-blur">
			<div className="flex h-16 items-center gap-4 px-6">
				<Link
					href="/projects"
					className="flex size-10 items-center justify-center rounded-lg bg-primary font-semibold text-lg text-primary-foreground"
					aria-label="blaze"
				>
					b
				</Link>

				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">{workspace}</span>
					<span className="rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
						{plan}
					</span>
				</div>

				<div className="ml-auto flex items-center gap-3">
					<span
						className={
							healthy
								? "flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-success text-xs"
								: "flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-destructive text-xs"
						}
					>
						<span
							className={
								healthy
									? "size-1.5 rounded-full bg-success"
									: "size-1.5 rounded-full bg-destructive"
							}
						/>
						{healthy ? "All OK" : "Degraded"}
					</span>

					<a
						href="https://github.com/crafter-station/blaze#readme"
						target="_blank"
						rel="noreferrer"
						className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
						aria-label="Docs"
					>
						<CircleHelp className="size-[18px]" />
					</a>

					<UserButton />
				</div>
			</div>
		</header>
	);
}

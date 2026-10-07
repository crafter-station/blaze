import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { Isotype, Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/toggle";
import { LIMITS } from "@/lib/limits";

/**
 * Two-column frame for sign-in, sign-up and the waitlist. The Clerk component does the
 * work on the right; the left panel says, briefly and truthfully, what you are signing
 * into. Below `lg` the panel drops away and the form stands alone.
 */
export function AuthShell({
	children,
	title,
	description,
}: {
	children: React.ReactNode;
	title: string;
	description: string;
}) {
	const facts = [
		`${LIMITS.DATABASES_PER_USER} databases, ${LIMITS.STORAGE_BYTES / 1024 / 1024} MB each`,
		"PostgreSQL, MySQL, MariaDB and Redis today",
		"REST API, MCP server and dashboard",
		"Free while in alpha, no card",
	];

	return (
		<div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<aside className="relative isolate hidden overflow-hidden border-border border-r bg-card lg:flex lg:flex-col lg:justify-between lg:p-12">
				<div
					aria-hidden="true"
					className="absolute inset-0 -z-10 [background-image:radial-gradient(var(--border-strong)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(70%_60%_at_30%_30%,black,transparent)]"
				/>
				<div
					aria-hidden="true"
					className="absolute inset-0 -z-10 bg-[radial-gradient(50%_40%_at_20%_15%,var(--brand-soft),transparent)]"
				/>
				<Link
					href="/"
					aria-label="blaze home"
					className="w-fit rounded-md focus-visible:outline-2 focus-visible:outline-ring"
				>
					<Logo />
				</Link>

				<div className="max-w-md">
					<Isotype className="h-16" animated />
					<p className="mt-8 font-semibold text-4xl leading-[1.05] tracking-[-0.04em]">
						Any database in <span className="font-mono text-brand-text">200ms</span>.
					</p>
					<ul className="mt-8 space-y-3 text-muted-foreground text-sm">
						{facts.map((fact) => (
							<li key={fact} className="flex items-center gap-2.5">
								<Check className="size-4 text-foreground/70" />
								{fact}
							</li>
						))}
					</ul>
				</div>

				<p className="text-muted-foreground text-xs">
					No testimonials here on purpose. Read the{" "}
					<Link href="/docs" className="text-foreground underline-offset-4 hover:underline">
						docs
					</Link>{" "}
					and judge for yourself.
				</p>
			</aside>

			<main id="main" className="flex min-h-dvh flex-col">
				<div className="flex h-16 items-center justify-between px-5 sm:px-8">
					<Link
						href="/"
						className="inline-flex items-center gap-1.5 rounded-sm text-muted-foreground text-sm transition-colors hover:text-foreground"
					>
						<ArrowLeft className="size-3.5" />
						<span className="lg:hidden">
							<Logo size="sm" />
						</span>
						<span className="hidden lg:inline">Back to blaze</span>
					</Link>
					<ThemeToggle />
				</div>
				<div className="flex flex-1 flex-col items-center justify-center px-5 pt-4 pb-16 sm:px-8">
					<div className="mb-8 w-full max-w-[400px] text-center">
						<h1 className="font-semibold text-2xl tracking-[-0.02em]">{title}</h1>
						<p className="mt-2 text-balance text-muted-foreground text-sm">{description}</p>
					</div>
					<div className="w-full max-w-[380px]">{children}</div>
				</div>
			</main>
		</div>
	);
}

/**
 * Clerk appearance for components that sit inside AuthShell: the shell supplies the
 * heading, so Clerk's own header and card chrome are hidden to avoid saying it twice.
 */
export const embeddedAuthAppearance = {
	elements: {
		rootBox: "!w-full",
		cardBox: "!w-full !max-w-none !shadow-none !border-0 !rounded-xl !bg-transparent",
		card: "!bg-transparent !shadow-none !border-0 !px-1 !py-2",
		header: "!hidden",
		footer: "!bg-transparent [&>div]:!bg-transparent",
	},
};

import Link from "next/link";
import { Isotype } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Not found" };

/**
 * Shared 404. Also what an unowned database id resolves to, by design: the console never
 * confirms that someone else's database exists.
 */
export default function NotFound() {
	return (
		<main
			id="main"
			className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center"
		>
			<Isotype className="h-12 opacity-80" />
			<p className="mt-8 font-mono text-muted-foreground text-sm">404</p>
			<h1 className="mt-2 font-semibold text-3xl tracking-[-0.03em]">Nothing at this address.</h1>
			<p className="mt-3 max-w-sm text-muted-foreground">
				The page does not exist, or it belongs to a database you do not own.
			</p>
			<div className="mt-8 flex flex-wrap justify-center gap-3">
				<Button asChild size="lg">
					<Link href="/projects">Open the console</Link>
				</Button>
				<Button asChild size="lg" variant="ghost">
					<Link href="/">Home</Link>
				</Button>
			</div>
		</main>
	);
}

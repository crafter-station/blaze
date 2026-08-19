import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-screen">
			<header className="sticky top-0 z-10 border-border border-b bg-background/80 backdrop-blur">
				<div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
					<Link href="/projects" className="flex items-center gap-2">
						<span className="size-2.5 rounded-full bg-primary" />
						<span className="font-semibold tracking-tight">blaze</span>
					</Link>
					<UserButton />
				</div>
			</header>
			<main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
		</div>
	);
}

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Sidebar } from "@/components/dashboard/sidebar";
import { TopBar } from "@/components/dashboard/topbar";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/control/db";
import { databases } from "@/lib/control/schema";

export const dynamic = "force-dynamic";

async function controlPlaneHealthy(): Promise<boolean> {
	try {
		await db.execute(sql`select 1`);
		return true;
	} catch {
		return false;
	}
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	const user = await requireUser();

	// The sidebar's database section and switcher need the full list on every page, not
	// just the detail route — otherwise the section would pop in and out as you navigate.
	const [healthy, owned] = await Promise.all([
		controlPlaneHealthy(),
		db
			.select({ id: databases.id, name: databases.name, engine: databases.engine })
			.from(databases)
			.where(and(eq(databases.ownerUserId, user.id), isNull(databases.deletedAt)))
			.orderBy(asc(databases.name)),
	]);

	return (
		<div className="flex min-h-dvh">
			<a
				href="#main"
				className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:outline-2 focus:outline-ring"
			>
				Skip to content
			</a>
			<Sidebar databases={owned} />
			<div className="flex min-w-0 flex-1 flex-col">
				<TopBar
					workspace={user.email.split("@")[0]}
					plan={user.plan}
					healthy={healthy}
					databases={owned}
				/>
				<main id="main" className="flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
					<div className="mx-auto max-w-[1120px]">{children}</div>
				</main>
			</div>
		</div>
	);
}

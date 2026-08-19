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
			.select({ id: databases.id, name: databases.name })
			.from(databases)
			.where(and(eq(databases.ownerUserId, user.id), isNull(databases.deletedAt)))
			.orderBy(asc(databases.name)),
	]);

	return (
		<div className="flex min-h-screen">
			<Sidebar databases={owned} />
			<div className="flex min-w-0 flex-1 flex-col">
				<TopBar workspace={user.email.split("@")[0]} plan={user.plan} healthy={healthy} />
				<main className="flex-1 px-10 py-10">
					<div className="mx-auto max-w-[1200px]">{children}</div>
				</main>
			</div>
		</div>
	);
}

import { sql } from "drizzle-orm";
import { Sidebar } from "@/components/dashboard/sidebar";
import { TopBar } from "@/components/dashboard/topbar";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/control/db";

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
	const healthy = await controlPlaneHealthy();

	return (
		<div className="flex min-h-screen">
			<Sidebar />
			<div className="flex min-w-0 flex-1 flex-col">
				<TopBar workspace={user.email.split("@")[0]} plan={user.plan} healthy={healthy} />
				<main className="flex-1 px-10 py-10">
					<div className="mx-auto max-w-[1200px]">{children}</div>
				</main>
			</div>
		</div>
	);
}

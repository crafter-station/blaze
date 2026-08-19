import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/control/db";

export const dynamic = "force-dynamic";

/**
 * Liveness plus a real control-plane round trip.
 *
 * A health check that only proves the process is up would go green while blaze was
 * unable to read the one database it cannot function without, so this touches it.
 * Deliberately returns no schema detail or counts — it is a public endpoint.
 */
export async function GET() {
	try {
		await db.execute(sql`select 1`);
		return NextResponse.json({ status: "ok" });
	} catch {
		return NextResponse.json({ status: "degraded", control_plane: "unreachable" }, { status: 503 });
	}
}

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { apiJson, authenticate, isResponse, readBody } from "@/lib/api/http";
import { serializeProject } from "@/lib/api/serialize";
import { db } from "@/lib/control/db";
import { projects } from "@/lib/control/schema";
import { newId, slugify } from "@/lib/id";

export const dynamic = "force-dynamic";

const CreateBody = z.object({ name: z.string().min(1).max(60) });

export async function GET(request: Request) {
	const user = await authenticate(request);
	if (isResponse(user)) return user;

	const rows = await db.query.projects.findMany({
		where: eq(projects.ownerUserId, user.id),
		orderBy: [asc(projects.createdAt)],
	});

	return apiJson({ projects: rows.map(serializeProject) });
}

export async function POST(request: Request) {
	const user = await authenticate(request);
	if (isResponse(user)) return user;

	const body = await readBody(request, CreateBody);
	if (isResponse(body)) return body;

	const base = slugify(body.name, "project");

	// Slugs are unique per owner. Returning the existing project rather than erroring makes
	// this idempotent for an agent that cannot remember whether it already created one.
	const existing = await db.query.projects.findFirst({
		where: and(eq(projects.ownerUserId, user.id), eq(projects.slug, base)),
	});
	if (existing) return apiJson(serializeProject(existing));

	const [created] = await db
		.insert(projects)
		.values({ id: newId("proj"), ownerUserId: user.id, slug: base, name: body.name })
		.returning();

	return apiJson(serializeProject(created), 201);
}

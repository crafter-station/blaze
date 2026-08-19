import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { authenticateApiKey } from "@/lib/api-keys";
import type { User } from "@/lib/control/schema";

/**
 * Shared plumbing for `/v1`.
 *
 * Errors carry a stable machine-readable `code` alongside the human message. Agents are
 * the primary caller here and they branch on responses — matching on prose is how an
 * integration breaks the day someone improves the wording.
 */

export type ApiErrorCode =
	| "unauthorized"
	| "not_found"
	| "invalid_request"
	| "quota_exceeded"
	| "unsupported_engine"
	| "database_suspended"
	| "internal";

const STATUS: Record<ApiErrorCode, number> = {
	unauthorized: 401,
	not_found: 404,
	invalid_request: 400,
	quota_exceeded: 402,
	unsupported_engine: 400,
	database_suspended: 409,
	internal: 500,
};

export function apiError(code: ApiErrorCode, message: string) {
	return NextResponse.json({ error: { code, message } }, { status: STATUS[code] });
}

export function apiJson<T>(data: T, status = 200) {
	return NextResponse.json(data, { status });
}

/**
 * Resolve the bearer token to a user, or return the 401 to send back.
 *
 * A missing header, a malformed one, an unknown key and a revoked key all produce the
 * same response. Distinguishing them would let someone probe which keys exist.
 */
export async function authenticate(request: Request): Promise<User | NextResponse> {
	const header = request.headers.get("authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

	if (!token) {
		return apiError("unauthorized", "Missing Authorization header. Use: Bearer blz_live_...");
	}

	const user = await authenticateApiKey(token);
	if (!user) return apiError("unauthorized", "Invalid or revoked API key.");
	return user;
}

export function isResponse(value: unknown): value is NextResponse {
	return value instanceof NextResponse;
}

/** Parse and validate a JSON body, returning the 400 to send back on failure. */
export async function readBody<T extends z.ZodTypeAny>(
	request: Request,
	schema: T,
): Promise<z.infer<T> | NextResponse> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return apiError("invalid_request", "Body must be valid JSON.");
	}

	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		const detail = parsed.error.issues
			.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
			.join("; ");
		return apiError("invalid_request", detail);
	}
	return parsed.data;
}

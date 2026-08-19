import "server-only";
import { env } from "@/lib/env";

export class DokployError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = "DokployError";
	}
}

export async function dokployFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
	const base = env.DOKPLOY_API_URL.replace(/\/+$/, "");
	const url = `${base}/${path.replace(/^\/+/, "")}`;

	const response = await fetch(url, {
		...init,
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"x-api-key": env.DOKPLOY_API_KEY,
			...((init.headers as Record<string, string>) ?? {}),
		},
	});

	const text = await response.text();

	if (!response.ok) {
		throw new DokployError(response.status, text);
	}

	try {
		return JSON.parse(text) as T;
	} catch {
		return text as unknown as T;
	}
}

export async function dokployGet<T = unknown>(
	path: string,
	params?: Record<string, string>,
): Promise<T> {
	let query = "";
	if (params) {
		const qs = new URLSearchParams(params).toString();
		if (qs) query = `?${qs}`;
	}
	return dokployFetch<T>(`${path}${query}`, { method: "GET" });
}

export async function dokployPost<T = unknown>(
	path: string,
	body?: Record<string, unknown>,
): Promise<T> {
	return dokployFetch<T>(path, {
		method: "POST",
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
}

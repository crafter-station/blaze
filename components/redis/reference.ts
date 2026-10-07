"use client";

import { useCallback, useEffect, useState } from "react";
import { commandReferenceAction } from "@/app/(dashboard)/databases/[id]/console/actions";
import type { CommandReference } from "@/lib/redis/types";

/**
 * The command reference (COMMAND DOCS, version, modules) for one database, fetched once
 * and kept across client-side navigation, so moving between the Browser and the Console
 * does not refetch a few hundred kilobytes of docs.
 */

const cache = new Map<string, CommandReference>();
const requests = new Map<string, ReturnType<typeof commandReferenceAction>>();

export function useCommandReference(databaseId: string) {
	const [reference, setReference] = useState<CommandReference | null>(
		() => cache.get(databaseId) ?? null,
	);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setError(null);
		let request = requests.get(databaseId);
		if (!request) {
			request = commandReferenceAction(databaseId).finally(() => requests.delete(databaseId));
			requests.set(databaseId, request);
		}
		try {
			const result = await request;
			if (result.ok) {
				const { ok: _ok, ...value } = result;
				cache.set(databaseId, value);
				setReference(value);
			} else setError(result.error);
		} catch {
			setError("Could not reach the server");
		}
	}, [databaseId]);

	useEffect(() => {
		if (!cache.has(databaseId)) void load();
	}, [databaseId, load]);

	return { reference, error, reload: load };
}

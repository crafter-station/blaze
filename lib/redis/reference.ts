import "server-only";
import type { OwnedRedis } from "./access";
import type { RedisConnection } from "./client";
import { indexFromNames, parseCommandDocs } from "./commands";
import { asList, asPairs, asText, respToJs } from "./resp";
import { withTenantRedis } from "./tenant";
import type { CommandReference, ServerInfo } from "./types";

/**
 * The command reference and server facts for one tenant: `COMMAND DOCS` (so completion
 * and hints describe exactly this server, modules included), the Redis version and the
 * loaded modules.
 *
 * Cached per database for a while: it only changes when the image does, and the docs
 * reply is a few hundred kilobytes.
 */

const cache = new Map<string, { at: number; value: CommandReference }>();
const TTL_MS = 10 * 60_000;

export async function serverInfo(conn: RedisConnection): Promise<ServerInfo> {
	const [info, modules] = await conn.pipeline([
		["INFO", "server"],
		["MODULE", "LIST"],
	]);
	const version = /redis_version:([^\r\n]+)/.exec(asText(info) ?? "")?.[1] ?? null;
	// MODULE LIST may be refused by the ACL; then module commands still show up in docs.
	const names =
		modules.type === "error"
			? []
			: asList(modules)
					.map((entry) => asPairs(entry).find(([k]) => k === "name")?.[1])
					.map((name) => asText(name) ?? "")
					.filter(Boolean);
	return { version, modules: names };
}

export async function commandReference(record: OwnedRedis): Promise<CommandReference> {
	const hit = cache.get(record.id);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

	const value = await withTenantRedis(
		record,
		async (conn): Promise<CommandReference> => {
			const server = await serverInfo(conn);
			const docs = await conn.call(["COMMAND", "DOCS"], { timeoutMs: 10_000 });
			if (docs.type !== "error") {
				return { index: parseCommandDocs(respToJs(docs)), server };
			}
			const names = await conn.call(["COMMAND", "LIST"]);
			return {
				index: indexFromNames(asList(names).map((n) => asText(n) ?? "")),
				server,
				namesOnly: true,
			};
		},
		{ clientName: "blaze-console" },
	);
	cache.set(record.id, { at: Date.now(), value });
	return value;
}

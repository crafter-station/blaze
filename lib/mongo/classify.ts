import { type EJsonValue, isObject } from "./literal";
import { isEmptyFilter, type ShellCommand } from "./shell";

/**
 * What the shell does with a parsed command before it reaches MongoDB.
 *
 * None of this is a security boundary: the tenant's own Mongo user (`dbOwner` on its
 * database and nothing else) is. These rules exist because the shell runs every command on
 * a short-lived connection, and because a few commands are destructive enough to deserve a
 * second look.
 *
 * - **blocked**: needs a cursor or stream that outlives the request (change streams,
 *   tailable cursors, `getMore`). Refused with an explanation.
 * - **confirm**: removes data in bulk — a delete or update with an empty filter, dropping a
 *   collection or an index, and dropping the whole database, which additionally requires
 *   typing its name.
 */

export type Access = "read" | "write" | "admin";

export interface Confirmation {
	message: string;
	/** When set, the user must type exactly this to proceed. */
	typeToConfirm?: string;
}

export interface Classification {
	/** Short label for history and results, e.g. `orders.find`, `ping`. */
	label: string;
	access: Access;
	blocked?: string;
	confirm?: Confirmation;
}

/** Database commands that only read. Anything else is treated as a write. */
const READ_COMMANDS = new Set(
	[
		"ping",
		"hello",
		"isMaster",
		"ismaster",
		"buildInfo",
		"buildinfo",
		"connectionStatus",
		"dbStats",
		"dbstats",
		"collStats",
		"listCollections",
		"listIndexes",
		"count",
		"distinct",
		"find",
		"aggregate",
		"explain",
		"validate",
		"dataSize",
		"getParameter",
		"getClusterParameter",
		"hostInfo",
		"serverStatus",
		"listCommands",
		"getLog",
		"usersInfo",
		"rolesInfo",
		"currentOp",
	].map((c) => c.toLowerCase()),
);

const BLOCKED_COMMANDS: Record<string, string> = {
	getmore:
		"getMore continues a cursor, and the shell's cursors close as soon as each command finishes. Ask for what you need in one command (with a limit).",
	killcursors:
		"The shell's cursors close as soon as each command finishes; there is nothing to kill.",
};

const CHANGE_STREAM =
	"Change streams stay open for as long as you listen. The shell runs each command on a short-lived connection, so use mongosh or a driver for this.";

function pipelineHasChangeStream(pipeline: EJsonValue | undefined): boolean {
	return Array.isArray(pipeline) && pipeline.some((s) => isObject(s) && "$changeStream" in s);
}

/** Classify a raw database command document by its first key, as the server does. */
function classifyCommand(command: Record<string, EJsonValue>, dbName: string): Classification {
	const [name] = Object.keys(command);
	const lower = name.toLowerCase();
	const label = name;
	if (BLOCKED_COMMANDS[lower]) return { label, access: "read", blocked: BLOCKED_COMMANDS[lower] };
	if (lower === "find" && (command.tailable || command.awaitData)) {
		return { label, access: "read", blocked: CHANGE_STREAM };
	}
	if (lower === "aggregate" && pipelineHasChangeStream(command.pipeline)) {
		return { label, access: "read", blocked: CHANGE_STREAM };
	}

	if (lower === "dropdatabase") {
		return {
			label,
			access: "admin",
			confirm: {
				message: `This deletes the database ${dbName}: every collection, document and index in it. It cannot be undone.`,
				typeToConfirm: dbName,
			},
		};
	}
	if (lower === "drop") {
		return {
			label,
			access: "admin",
			confirm: {
				message: `This drops the collection ${String(command[name])} and every document in it.`,
			},
		};
	}
	if (lower === "dropindexes" || lower === "deleteindexes") {
		return {
			label,
			access: "admin",
			confirm: { message: `This drops indexes on ${String(command[name])}.` },
		};
	}
	if (lower === "delete" && Array.isArray(command.deletes)) {
		const all = command.deletes.some((d) => isObject(d) && isEmptyFilter(d.q) && d.limit === 0);
		return {
			label,
			access: "write",
			...(all && {
				confirm: { message: `This deletes every document in ${String(command[name])}.` },
			}),
		};
	}
	if (lower === "update" && Array.isArray(command.updates)) {
		const all = command.updates.some((u) => isObject(u) && isEmptyFilter(u.q) && u.multi === true);
		return {
			label,
			access: "write",
			...(all && {
				confirm: { message: `This updates every document in ${String(command[name])}.` },
			}),
		};
	}
	if (lower === "aggregate" && Array.isArray(command.pipeline)) {
		const writes = command.pipeline.some((s) => isObject(s) && ("$out" in s || "$merge" in s));
		return { label, access: writes ? "write" : "read" };
	}
	return { label, access: READ_COMMANDS.has(lower) ? "read" : "write" };
}

export function classify(command: ShellCommand, dbName: string): Classification {
	switch (command.type) {
		case "blocked":
			return { label: command.name, access: "read", blocked: command.reason };
		case "show":
			return { label: `show ${command.what}`, access: "read" };
		case "command":
			return classifyCommand(command.command, dbName);
		case "db":
			switch (command.method) {
				case "dropDatabase":
					return {
						label: "db.dropDatabase",
						access: "admin",
						confirm: {
							message: `This deletes the database ${dbName}: every collection, document and index in it. It cannot be undone.`,
							typeToConfirm: dbName,
						},
					};
				case "createCollection":
					return { label: "db.createCollection", access: "admin" };
				default:
					return { label: `db.${command.method}`, access: "read" };
			}
		case "collection": {
			const { collection, method, args } = command;
			const label = `${collection}.${method}`;
			switch (method) {
				case "find":
				case "findOne":
				case "countDocuments":
				case "estimatedDocumentCount":
				case "distinct":
				case "getIndexes":
					return { label, access: "read" };
				case "aggregate": {
					const pipeline = args[0];
					const writes =
						Array.isArray(pipeline) &&
						pipeline.some((s) => isObject(s) && ("$out" in s || "$merge" in s));
					return { label, access: writes ? "write" : "read" };
				}
				case "deleteMany":
					return {
						label,
						access: "write",
						...(isEmptyFilter(args[0]) && {
							confirm: {
								message: `deleteMany with an empty filter deletes every document in ${collection}. It cannot be undone.`,
							},
						}),
					};
				case "updateMany":
					return {
						label,
						access: "write",
						...(isEmptyFilter(args[0]) && {
							confirm: {
								message: `updateMany with an empty filter changes every document in ${collection}.`,
							},
						}),
					};
				case "drop":
					return {
						label,
						access: "admin",
						confirm: {
							message: `This drops the collection ${collection}, with every document and index in it. It cannot be undone.`,
						},
					};
				case "dropIndex":
					return {
						label,
						access: "admin",
						confirm: {
							message:
								args[0] === "*"
									? `This drops every index on ${collection} except _id.`
									: `This drops the index ${typeof args[0] === "string" ? args[0] : JSON.stringify(args[0])} on ${collection}.`,
						},
					};
				case "createIndex":
					return { label, access: "admin" };
				default:
					return { label, access: "write" };
			}
		}
	}
}

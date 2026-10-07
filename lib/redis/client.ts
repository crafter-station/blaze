import "server-only";
import { isIP } from "node:net";
import tls from "node:tls";
import { asText, encodeCommand, RespParser, type RespValue } from "./resp";

/**
 * A minimal RESP3 connection over TLS, one per request.
 *
 * Deliberately small: send commands, read typed replies in order, fail fast. Connection
 * pooling and reconnection are exactly what a request path should not have here: every
 * console run or browser action opens a connection as the tenant, does its work and closes
 * it, so nothing a tenant does can leak into the next request's session state.
 *
 * TLS is the only listener on tenant containers. The certificate is self-signed and
 * generated on the box, so there is no chain to verify, the same as `lib/provision/redis.ts`;
 * the hop is still encrypted, and the server refuses plaintext.
 */

export interface RedisConnectOptions {
	host: string;
	port: number;
	user: string;
	password: string;
	connectTimeoutMs?: number;
	commandTimeoutMs?: number;
	/** Largest reply buffered before the connection is dropped. */
	maxReplyBytes?: number;
	clientName?: string;
}

export class RedisConnectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RedisConnectionError";
	}
}

export class RedisReplyTooLargeError extends Error {
	constructor(limit: number) {
		super(
			`The reply is larger than ${Math.round(limit / 1_000_000)} MB, so it was not read. Narrow the command, for example with SCAN, LRANGE or HSCAN and a COUNT.`,
		);
		this.name = "RedisReplyTooLargeError";
	}
}

/** An error reply from Redis, thrown by `callOk`. */
export class RedisCommandError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RedisCommandError";
	}
}

interface Pending {
	resolve: (value: RespValue) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export interface RedisConnection {
	/** Send one command; error replies resolve as `{ type: "error" }` values. */
	call(args: (string | Uint8Array)[], options?: { timeoutMs?: number }): Promise<RespValue>;
	/** Like `call`, but an error reply throws `RedisCommandError`. */
	callOk(args: (string | Uint8Array)[], options?: { timeoutMs?: number }): Promise<RespValue>;
	/** Send several commands at once and read their replies in order. */
	pipeline(commands: (string | Uint8Array)[][]): Promise<RespValue[]>;
	/** RESP version negotiated: 3 normally, 2 if the server refused HELLO 3. */
	readonly protocol: 2 | 3;
	close(): void;
}

export async function connectRedis(options: RedisConnectOptions): Promise<RedisConnection> {
	const connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
	const commandTimeoutMs = options.commandTimeoutMs ?? 10_000;
	const maxReplyBytes = options.maxReplyBytes ?? 16_000_000;

	const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
		const s = tls.connect({
			host: options.host,
			port: options.port,
			// SNI only makes sense for a hostname; Node warns when given an IP.
			servername: isIP(options.host) ? undefined : options.host,
			rejectUnauthorized: false,
		});
		const timer = setTimeout(() => {
			s.destroy();
			reject(new RedisConnectionError("Timed out connecting to Redis."));
		}, connectTimeoutMs);
		s.once("secureConnect", () => {
			clearTimeout(timer);
			resolve(s);
		});
		s.once("error", (error: Error) => {
			clearTimeout(timer);
			reject(new RedisConnectionError(`Could not connect to Redis: ${error.message}`));
		});
	});
	socket.setNoDelay(true);

	const parser = new RespParser();
	const pending: Pending[] = [];
	let failure: Error | null = null;

	const failAll = (error: Error) => {
		if (!failure) failure = error;
		for (const item of pending.splice(0)) {
			clearTimeout(item.timer);
			item.reject(error);
		}
		socket.destroy();
	};

	socket.on("data", (chunk: Buffer) => {
		try {
			parser.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
		} catch (error) {
			failAll(new RedisConnectionError(`Unreadable reply: ${(error as Error).message}`));
			return;
		}
		for (let value = parser.next(); value; value = parser.next()) {
			// Out-of-band pushes (client tracking, keyspace notifications) answer nothing.
			if (value.type === "push") continue;
			const item = pending.shift();
			if (!item) continue;
			clearTimeout(item.timer);
			item.resolve(value);
		}
		if (parser.pendingBytes > maxReplyBytes) failAll(new RedisReplyTooLargeError(maxReplyBytes));
	});
	socket.on("error", (error) => failAll(new RedisConnectionError(error.message)));
	socket.on("close", () => failAll(new RedisConnectionError("The connection to Redis closed.")));

	const send = (args: (string | Uint8Array)[], timeoutMs = commandTimeoutMs) =>
		new Promise<RespValue>((resolve, reject) => {
			if (failure) {
				reject(failure);
				return;
			}
			const timer = setTimeout(() => {
				// Replies arrive in order; one that never comes leaves the rest misaligned.
				failAll(
					new RedisConnectionError(`Redis did not answer within ${Math.round(timeoutMs / 1000)}s.`),
				);
			}, timeoutMs);
			pending.push({ resolve, reject, timer });
			socket.write(encodeCommand(args));
		});

	const callOk = async (args: (string | Uint8Array)[], opts?: { timeoutMs?: number }) => {
		const value = await send(args, opts?.timeoutMs);
		if (value.type === "error") throw new RedisCommandError(value.value);
		return value;
	};

	// Authenticate and switch to RESP3 in one round trip.
	let protocol: 2 | 3 = 3;
	const hello = await send([
		"HELLO",
		"3",
		"AUTH",
		options.user,
		options.password,
		"SETNAME",
		options.clientName ?? "blaze-console",
	]).catch((error: Error) => {
		socket.destroy();
		throw error;
	});
	if (hello.type === "error") {
		if (/NOPROTO|unknown command/i.test(hello.value)) {
			protocol = 2;
			const auth = await send(["AUTH", options.user, options.password]);
			if (auth.type === "error") {
				socket.destroy();
				throw new RedisConnectionError(authMessage(auth.value));
			}
		} else {
			socket.destroy();
			throw new RedisConnectionError(authMessage(hello.value));
		}
	}

	return {
		call: (args, opts) => send(args, opts?.timeoutMs),
		callOk,
		async pipeline(commands) {
			return Promise.all(commands.map((args) => send(args)));
		},
		get protocol() {
			return protocol;
		},
		close() {
			for (const item of pending.splice(0)) {
				clearTimeout(item.timer);
				item.reject(new RedisConnectionError("Connection closed."));
			}
			failure ??= new RedisConnectionError("Connection closed.");
			socket.end();
			socket.destroy();
		},
	};
}

function authMessage(raw: string): string {
	if (/WRONGPASS|invalid username-password|disabled/i.test(raw)) {
		return "Redis refused the database credentials. If the database was just suspended or its password rotated, reload the page.";
	}
	return `Redis refused the connection: ${raw}`;
}

export { asText };

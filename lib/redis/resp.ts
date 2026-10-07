/**
 * RESP2/RESP3 wire format: an encoder for commands and an incremental, resumable parser
 * for replies.
 *
 * blaze speaks RESP3 to tenant Redis (after `HELLO 3`) rather than going through ioredis,
 * because the console has to show replies *as Redis typed them*: a map is a map, a set is
 * a set, a double is a double, and a bulk string is bytes rather than a JS string that
 * already lost whatever was not UTF-8. ioredis speaks only RESP2 and decodes eagerly.
 *
 * The parser is pure (no sockets), so it is unit-tested directly. It is resumable rather
 * than re-parsing from the start on every chunk: a 10 MB reply arriving in 64 KB chunks
 * would otherwise be scanned ~160 times.
 */

export type RespValue =
	| { type: "simple"; value: string }
	| { type: "error"; value: string }
	| { type: "integer"; value: string }
	| { type: "bulk"; value: Uint8Array }
	| { type: "null" }
	| { type: "array" | "set" | "push"; items: RespValue[] }
	| { type: "map"; entries: [RespValue, RespValue][] }
	| { type: "double"; value: string }
	| { type: "boolean"; value: boolean }
	| { type: "bignum"; value: string }
	| { type: "verbatim"; format: string; value: Uint8Array };

const CRLF = new Uint8Array([13, 10]);
const encoder = new TextEncoder();
const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");

export function toBytes(arg: string | Uint8Array): Uint8Array {
	return typeof arg === "string" ? encoder.encode(arg) : arg;
}

/** `*N\r\n$len\r\narg\r\n...`: the only request format Redis needs. */
export function encodeCommand(args: (string | Uint8Array)[]): Uint8Array {
	const parts: Uint8Array[] = [encoder.encode(`*${args.length}\r\n`)];
	for (const arg of args) {
		const bytes = toBytes(arg);
		parts.push(encoder.encode(`$${bytes.length}\r\n`), bytes, CRLF);
	}
	let size = 0;
	for (const part of parts) size += part.length;
	const out = new Uint8Array(size);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

export class RespProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RespProtocolError";
	}
}

/** A container being filled: how many children it still expects, and what it holds. */
interface Frame {
	kind: "array" | "set" | "push" | "map" | "attribute";
	remaining: number;
	items: RespValue[];
}

/**
 * Feed bytes with `push`, take complete replies with `next`.
 *
 * Attributes (`|`) are metadata attached to the following reply; they are read and
 * discarded, which is what every client that does not opt into them does.
 */
export class RespParser {
	private buffer = new Uint8Array(0);
	private offset = 0;
	private stack: Frame[] = [];
	private ready: RespValue[] = [];

	push(chunk: Uint8Array): void {
		const rest = this.buffer.subarray(this.offset);
		const merged = new Uint8Array(rest.length + chunk.length);
		merged.set(rest, 0);
		merged.set(chunk, rest.length);
		this.buffer = merged;
		this.offset = 0;
		this.drain();
	}

	/** Bytes received but not yet consumed by a complete top-level reply. */
	get pendingBytes(): number {
		return this.buffer.length - this.offset;
	}

	next(): RespValue | undefined {
		return this.ready.shift();
	}

	private line(from: number): { text: string; end: number } | null {
		for (let i = from; i < this.buffer.length - 1; i++) {
			if (this.buffer[i] === 13 && this.buffer[i + 1] === 10) {
				return { text: latin1.decode(this.buffer.subarray(from, i)), end: i + 2 };
			}
		}
		return null;
	}

	private drain(): void {
		for (;;) {
			const value = this.readOne();
			if (value === undefined) return;
			this.complete(value);
		}
	}

	/** Attach a finished value to the open container, closing containers that fill up. */
	private complete(initial: RespValue | "open"): void {
		let value: RespValue | "open" | "attribute-done" = initial;
		for (;;) {
			if (value === "open") return;
			const frame = this.stack[this.stack.length - 1];
			if (!frame) {
				if (value !== "attribute-done") this.ready.push(value);
				return;
			}
			if (value !== "attribute-done") {
				frame.items.push(value);
				frame.remaining--;
			}
			if (frame.remaining > 0) return;
			this.stack.pop();
			value = this.close(frame);
		}
	}

	private close(frame: Frame): RespValue | "attribute-done" {
		if (frame.kind === "attribute") return "attribute-done";
		if (frame.kind === "map") {
			const entries: [RespValue, RespValue][] = [];
			for (let i = 0; i + 1 < frame.items.length; i += 2) {
				entries.push([frame.items[i], frame.items[i + 1]]);
			}
			return { type: "map", entries };
		}
		return { type: frame.kind, items: frame.items };
	}

	/**
	 * Read one element at the cursor. Returns a scalar, `"open"` when a non-empty container
	 * was pushed onto the stack, or undefined when more bytes are needed (the cursor is
	 * left where it was, so the element is read again once they arrive).
	 */
	private readOne(): RespValue | "open" | undefined {
		if (this.offset >= this.buffer.length) return undefined;
		const start = this.offset;
		const prefix = String.fromCharCode(this.buffer[start]);
		const header = this.line(start + 1);
		if (!header) return undefined;
		const { text, end } = header;

		const take = (value: RespValue | "open") => {
			this.offset = end;
			return value;
		};

		switch (prefix) {
			case "+":
				return take({
					type: "simple",
					value: utf8.decode(this.buffer.subarray(start + 1, end - 2)),
				});
			case "-":
				return take({
					type: "error",
					value: utf8.decode(this.buffer.subarray(start + 1, end - 2)),
				});
			case ":":
				return take({ type: "integer", value: text });
			case ",":
				return take({ type: "double", value: text });
			case "(":
				return take({ type: "bignum", value: text });
			case "#":
				return take({ type: "boolean", value: text === "t" });
			case "_":
				return take({ type: "null" });
			case "$":
			case "!":
			case "=": {
				const length = Number(text);
				if (!Number.isInteger(length)) throw new RespProtocolError(`Bad length: ${text}`);
				if (length < 0) return take({ type: "null" });
				if (this.buffer.length < end + length + 2) return undefined;
				const body = this.buffer.slice(end, end + length);
				this.offset = end + length + 2;
				if (prefix === "!") return { type: "error", value: utf8.decode(body) };
				if (prefix === "=") {
					// Verbatim strings carry a three-letter format and a colon: `txt:...`.
					return {
						type: "verbatim",
						format: latin1.decode(body.subarray(0, 3)),
						value: body.slice(4),
					};
				}
				return { type: "bulk", value: body };
			}
			case "*":
			case "~":
			case ">":
			case "%":
			case "|": {
				const count = Number(text);
				if (!Number.isInteger(count)) throw new RespProtocolError(`Bad count: ${text}`);
				if (count < 0) return take({ type: "null" });
				const kind =
					prefix === "*"
						? "array"
						: prefix === "~"
							? "set"
							: prefix === ">"
								? "push"
								: prefix === "%"
									? "map"
									: "attribute";
				const children = kind === "map" || kind === "attribute" ? count * 2 : count;
				if (children === 0) {
					if (kind === "attribute") {
						this.offset = end;
						return this.readOne();
					}
					return take(kind === "map" ? { type: "map", entries: [] } : { type: kind, items: [] });
				}
				this.offset = end;
				this.stack.push({ kind, remaining: children, items: [] });
				return "open";
			}
			default:
				throw new RespProtocolError(`Unexpected reply prefix ${JSON.stringify(prefix)}`);
		}
	}
}

/* ------------------------------------------------------------------ *
 * Small readers used by the server code
 * ------------------------------------------------------------------ */

export function isUtf8(bytes: Uint8Array): boolean {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

/** Text of a scalar reply; bulk strings decoded as UTF-8 (lossy). */
export function asText(value: RespValue | undefined): string | null {
	if (!value) return null;
	switch (value.type) {
		case "simple":
		case "error":
		case "integer":
		case "double":
		case "bignum":
			return value.value;
		case "bulk":
		case "verbatim":
			return utf8.decode(value.value);
		case "boolean":
			return value.value ? "1" : "0";
		default:
			return null;
	}
}

export function asNumber(value: RespValue | undefined): number {
	const text = asText(value);
	return text === null ? Number.NaN : Number(text);
}

/** Children of an aggregate, flattening a map into key, value, key, value (RESP2 shape). */
export function asList(value: RespValue | undefined): RespValue[] {
	if (!value) return [];
	if (value.type === "array" || value.type === "set" || value.type === "push") return value.items;
	if (value.type === "map") return value.entries.flat();
	return [];
}

/** A map reply, or a flat RESP2 array of alternating keys and values, as pairs. */
export function asPairs(value: RespValue | undefined): [string, RespValue][] {
	if (!value) return [];
	if (value.type === "map") return value.entries.map(([k, v]) => [asText(k) ?? "", v]);
	const items = asList(value);
	const pairs: [string, RespValue][] = [];
	for (let i = 0; i + 1 < items.length; i += 2) pairs.push([asText(items[i]) ?? "", items[i + 1]]);
	return pairs;
}

/**
 * Decode a reply into plain JS, for structured replies the server reads itself
 * (`COMMAND DOCS`, `INFO`-like maps): maps become objects, aggregates arrays, strings
 * UTF-8 text, numbers numbers. Not for tenant data, which keeps its bytes.
 */
export function respToJs(value: RespValue): unknown {
	switch (value.type) {
		case "map": {
			const out: Record<string, unknown> = {};
			for (const [k, v] of value.entries) out[asText(k) ?? ""] = respToJs(v);
			return out;
		}
		case "array":
		case "set":
		case "push":
			return value.items.map(respToJs);
		case "integer":
		case "double":
			return Number(value.value);
		case "boolean":
			return value.value;
		case "null":
			return null;
		default:
			return asText(value);
	}
}

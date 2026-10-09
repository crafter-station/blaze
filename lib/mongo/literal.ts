/**
 * A parser for the values people type into a Mongo shell, **without eval**.
 *
 * mongosh arguments are JavaScript, and evaluating JavaScript from a browser on blaze's
 * servers is not something this product will ever do. What people actually type is a small,
 * well-defined subset: JSON5-ish literals (unquoted keys, single quotes, trailing commas,
 * comments, regex literals) plus the shell's type constructors (`ObjectId("…")`,
 * `ISODate("…")`, `NumberLong(…)` and friends). This module parses exactly that subset
 * and nothing else, and maps every constructor onto its **Extended JSON v2** form, so the
 * server can hand the result to `EJSON.deserialize` and get real BSON types back.
 *
 * Pure and dependency-free: the same parser drives the shell's live syntax checking in
 * the browser and the authoritative parse on the server.
 */

export type EJsonValue =
	| null
	| boolean
	| number
	| string
	| EJsonValue[]
	| { [key: string]: EJsonValue };

export type EJsonObject = { [key: string]: EJsonValue };

export class LiteralParseError extends Error {
	constructor(
		message: string,
		/** 0-based offset into the source where the problem was found. */
		readonly position: number,
	) {
		super(message);
		this.name = "LiteralParseError";
	}
}

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;
const HEX24 = /^[0-9a-fA-F]{24}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/;

/** Regex options MongoDB understands. JavaScript's `g` and `y` mean nothing to the server. */
const REGEX_OPTIONS = new Set(["i", "m", "s", "x", "u", "l"]);

export function isObject(value: EJsonValue | undefined): value is EJsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A fresh ObjectId in hex, the way the server would mint one: seconds, then randomness. */
export function newObjectIdHex(now = Date.now()): string {
	const seconds = Math.floor(now / 1000)
		.toString(16)
		.padStart(8, "0");
	let rest = "";
	for (let i = 0; i < 16; i++) rest += Math.floor(Math.random() * 16).toString(16);
	return `${seconds}${rest}`;
}

function bytesToBase64(bytes: number[]): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

/**
 * Character-level recursive descent over one source string.
 *
 * Exposed as a class because the shell grammar (`db.coll.find(...).sort(...)`) reuses its
 * scanner and value parser to read call arguments in place, keeping positions in one
 * coordinate system for error messages.
 */
export class Scanner {
	pos = 0;
	constructor(readonly src: string) {}

	error(message: string, at = this.pos): never {
		throw new LiteralParseError(message, at);
	}

	get done(): boolean {
		this.skip();
		return this.pos >= this.src.length;
	}

	peek(): string {
		return this.src[this.pos] ?? "";
	}

	/** Skip whitespace and comments. */
	skip(): void {
		const s = this.src;
		while (this.pos < s.length) {
			const c = s[this.pos];
			if (c === " " || c === "\t" || c === "\n" || c === "\r") {
				this.pos++;
			} else if (c === "/" && s[this.pos + 1] === "/") {
				while (this.pos < s.length && s[this.pos] !== "\n") this.pos++;
			} else if (c === "/" && s[this.pos + 1] === "*") {
				const end = s.indexOf("*/", this.pos + 2);
				if (end === -1) this.error("Unterminated comment");
				this.pos = end + 2;
			} else {
				break;
			}
		}
	}

	/** Consume `ch` (after whitespace) if it is next. */
	eat(ch: string): boolean {
		this.skip();
		if (this.src[this.pos] === ch) {
			this.pos++;
			return true;
		}
		return false;
	}

	expect(ch: string, what = `"${ch}"`): void {
		if (!this.eat(ch)) {
			const found = this.pos < this.src.length ? `"${this.src[this.pos]}"` : "end of input";
			this.error(`Expected ${what} but found ${found}`);
		}
	}

	/** An identifier, or null when the next token is not one. */
	identifier(): string | null {
		this.skip();
		const start = this.pos;
		if (!ID_START.test(this.peek())) return null;
		this.pos++;
		while (this.pos < this.src.length && ID_PART.test(this.src[this.pos])) this.pos++;
		return this.src.slice(start, this.pos);
	}

	string(): string {
		this.skip();
		const quote = this.peek();
		if (quote !== '"' && quote !== "'" && quote !== "`") this.error("Expected a string");
		const start = this.pos;
		this.pos++;
		let out = "";
		const s = this.src;
		while (this.pos < s.length) {
			const c = s[this.pos++];
			if (c === quote) return out;
			if (quote === "`" && c === "$" && s[this.pos] === "{") {
				this.error("Template interpolation is not supported", this.pos - 1);
			}
			if (c === "\n" && quote !== "`") this.error("Unterminated string", start);
			if (c !== "\\") {
				out += c;
				continue;
			}
			const e = s[this.pos++];
			switch (e) {
				case "n":
					out += "\n";
					break;
				case "t":
					out += "\t";
					break;
				case "r":
					out += "\r";
					break;
				case "b":
					out += "\b";
					break;
				case "f":
					out += "\f";
					break;
				case "v":
					out += "\v";
					break;
				case "0":
					out += "\0";
					break;
				case "u": {
					if (s[this.pos] === "{") {
						const end = s.indexOf("}", this.pos);
						const hex = s.slice(this.pos + 1, end);
						if (end === -1 || !/^[0-9a-fA-F]{1,6}$/.test(hex)) this.error("Bad \\u{…} escape");
						out += String.fromCodePoint(Number.parseInt(hex, 16));
						this.pos = end + 1;
					} else {
						const hex = s.slice(this.pos, this.pos + 4);
						if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.error("Bad \\u escape");
						out += String.fromCharCode(Number.parseInt(hex, 16));
						this.pos += 4;
					}
					break;
				}
				case "x": {
					const hex = s.slice(this.pos, this.pos + 2);
					if (!/^[0-9a-fA-F]{2}$/.test(hex)) this.error("Bad \\x escape");
					out += String.fromCharCode(Number.parseInt(hex, 16));
					this.pos += 2;
					break;
				}
				case "\n":
					break;
				case undefined:
					this.error("Unterminated string", start);
					break;
				default:
					out += e;
			}
		}
		return this.error("Unterminated string", start);
	}

	number(): number {
		this.skip();
		const s = this.src;
		const start = this.pos;
		if (s[this.pos] === "+" || s[this.pos] === "-") this.pos++;
		if (s.startsWith("Infinity", this.pos)) {
			this.pos += 8;
			return s[start] === "-" ? -Infinity : Infinity;
		}
		if (s[this.pos] === "0" && /[xX]/.test(s[this.pos + 1] ?? "")) {
			this.pos += 2;
			const digits = start;
			while (/[0-9a-fA-F]/.test(s[this.pos] ?? "")) this.pos++;
			const text = s.slice(digits, this.pos).replace(/^[+-]?0[xX]/, "");
			if (!text) this.error("Bad hexadecimal number", start);
			const value = Number.parseInt(text, 16);
			return s[start] === "-" ? -value : value;
		}
		while (/[0-9_]/.test(s[this.pos] ?? "")) this.pos++;
		if (s[this.pos] === ".") {
			this.pos++;
			while (/[0-9_]/.test(s[this.pos] ?? "")) this.pos++;
		}
		if (/[eE]/.test(s[this.pos] ?? "")) {
			this.pos++;
			if (s[this.pos] === "+" || s[this.pos] === "-") this.pos++;
			while (/[0-9]/.test(s[this.pos] ?? "")) this.pos++;
		}
		const text = s.slice(start, this.pos).replace(/_/g, "");
		const value = Number(text);
		if (text === "" || text === "-" || text === "+" || Number.isNaN(value)) {
			this.error("Bad number", start);
		}
		if (ID_START.test(s[this.pos] ?? "")) this.error("Unexpected character after number");
		return value;
	}

	/** Digits only, for array indexes inside a dotted path (`items.0.sku`). */
	integerPart(): number {
		const start = this.pos;
		while (/[0-9]/.test(this.src[this.pos] ?? "")) this.pos++;
		return Number(this.src.slice(start, this.pos));
	}

	regex(): EJsonValue {
		const s = this.src;
		const start = this.pos;
		this.pos++; // opening slash
		let pattern = "";
		let inClass = false;
		while (true) {
			const c = s[this.pos];
			if (c === undefined || c === "\n") this.error("Unterminated regular expression", start);
			this.pos++;
			if (c === "\\") {
				// `\/` only exists to get past the literal's delimiter; the pattern means `/`.
				pattern += s[this.pos] === "/" ? "/" : c + (s[this.pos] ?? "");
				this.pos++;
				continue;
			}
			if (c === "[") inClass = true;
			else if (c === "]") inClass = false;
			else if (c === "/" && !inClass) break;
			pattern += c;
		}
		let flags = "";
		while (/[a-z]/i.test(s[this.pos] ?? "")) flags += s[this.pos++];
		return regexValue(pattern, flags, start, this);
	}

	/** Any value: literal, object, array, regex, or a shell type constructor. */
	value(): EJsonValue {
		this.skip();
		const c = this.peek();
		if (c === "{") return this.object();
		if (c === "[") return this.array();
		if (c === '"' || c === "'" || c === "`") return this.string();
		if (c === "/") return this.regex();
		if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) {
			const n = this.number();
			if (!Number.isFinite(n)) return { $numberDouble: n > 0 ? "Infinity" : "-Infinity" };
			if (Object.is(n, -0)) return { $numberDouble: "-0.0" };
			return n;
		}
		const start = this.pos;
		const name = this.identifier();
		if (name === null) {
			if (this.pos >= this.src.length) this.error("Expected a value but found end of input");
			this.error(`Unexpected "${c}"`);
		}
		switch (name) {
			case "true":
				return true;
			case "false":
				return false;
			case "null":
			case "undefined":
				return null;
			case "NaN":
				return { $numberDouble: "NaN" };
			case "Infinity":
				return { $numberDouble: "Infinity" };
			case "new": {
				const ctor = this.identifier();
				if (!ctor) this.error("Expected a constructor after new");
				return this.construct(ctor, start);
			}
			default:
				return this.construct(name, start);
		}
	}

	object(): EJsonObject {
		this.expect("{");
		const out: EJsonObject = {};
		if (this.eat("}")) return out;
		while (true) {
			this.skip();
			const keyAt = this.pos;
			const c = this.peek();
			let key: string;
			if (c === '"' || c === "'" || c === "`") key = this.string();
			else if (c >= "0" && c <= "9") key = String(this.number());
			else {
				const id = this.identifier();
				if (id === null) {
					if (c === "}") break; // trailing comma
					this.error(c ? `Expected a field name but found "${c}"` : "Expected a field name");
				}
				key = id;
				// JavaScript wants `"a.b": 1` quoted, but people type it bare; nothing is lost by
				// reading an unquoted dotted path as the field path it plainly means.
				while (this.src[this.pos] === ".") {
					this.pos++;
					const part = /[0-9]/.test(this.peek()) ? String(this.integerPart()) : this.identifier();
					if (part === null) this.error('Expected a field name after "."', keyAt);
					key += `.${part}`;
				}
			}
			this.expect(":", `":" after "${key}"`);
			out[key] = this.value();
			if (this.eat(",")) {
				if (this.eat("}")) return out;
				continue;
			}
			this.expect("}", '"," or "}"');
			return out;
		}
		this.expect("}");
		return out;
	}

	array(): EJsonValue[] {
		this.expect("[");
		const out: EJsonValue[] = [];
		if (this.eat("]")) return out;
		while (true) {
			out.push(this.value());
			if (this.eat(",")) {
				if (this.eat("]")) return out;
				continue;
			}
			this.expect("]", '"," or "]"');
			return out;
		}
	}

	/** Comma-separated values up to a closing parenthesis (already past the opening one). */
	callArgs(): EJsonValue[] {
		const args: EJsonValue[] = [];
		if (this.eat(")")) return args;
		while (true) {
			args.push(this.value());
			if (this.eat(",")) {
				if (this.eat(")")) return args;
				continue;
			}
			this.expect(")", '"," or ")"');
			return args;
		}
	}

	/** `Name(args)`, or a bare `MinKey` / `MaxKey`. */
	private construct(name: string, start: number): EJsonValue {
		const hasCall = this.eat("(");
		if (!hasCall) {
			if (name === "MinKey") return { $minKey: 1 };
			if (name === "MaxKey") return { $maxKey: 1 };
			this.error(
				`Unknown value "${name}". Strings need quotes; types are written like ObjectId("…")`,
				start,
			);
		}
		const argsAt = this.pos;
		const args = this.callArgs();
		return constructValue(name, args, start, argsAt, this);
	}
}

function regexValue(pattern: string, flags: string, at: number, sc: Scanner): EJsonValue {
	const options = [...new Set(flags.split(""))];
	for (const f of options) {
		if (!REGEX_OPTIONS.has(f)) {
			sc.error(`Regex flag "${f}" is not supported by MongoDB (use i, m, s, x or u)`, at);
		}
	}
	// Extended JSON wants the options sorted.
	return { $regularExpression: { pattern, options: options.sort().join("") } };
}

function stringArg(name: string, args: EJsonValue[], at: number, sc: Scanner): string {
	if (args.length !== 1 || typeof args[0] !== "string") {
		sc.error(`${name}() takes one string argument`, at);
	}
	return args[0];
}

function integerText(name: string, value: EJsonValue | undefined, at: number, sc: Scanner): string {
	const text =
		typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : null;
	if (text === null || !/^[+-]?\d+$/.test(text)) {
		sc.error(`${name}() takes an integer (as a number or a string)`, at);
	}
	return text.replace(/^\+/, "");
}

function constructValue(
	rawName: string,
	args: EJsonValue[],
	start: number,
	argsAt: number,
	sc: Scanner,
): EJsonValue {
	switch (rawName) {
		case "ObjectId":
		case "ObjectID": {
			if (args.length === 0) return { $oid: newObjectIdHex() };
			const hex = stringArg(rawName, args, argsAt, sc);
			if (!HEX24.test(hex)) sc.error("ObjectId needs 24 hexadecimal characters", argsAt);
			return { $oid: hex.toLowerCase() };
		}
		case "ISODate":
		case "Date": {
			if (args.length === 0) return { $date: new Date().toISOString() };
			const arg = args[0];
			const date =
				typeof arg === "number"
					? new Date(arg)
					: typeof arg === "string"
						? new Date(arg)
						: new Date(Number.NaN);
			if (args.length > 1 || Number.isNaN(date.getTime())) {
				sc.error(`${rawName}() needs a valid date string or milliseconds`, argsAt);
			}
			return { $date: date.toISOString() };
		}
		case "NumberLong":
		case "Long":
			return { $numberLong: integerText(rawName, args[0], argsAt, sc) };
		case "NumberInt":
		case "Int32": {
			const text = integerText(rawName, args[0], argsAt, sc);
			const n = Number(text);
			if (n > 2147483647 || n < -2147483648)
				sc.error(`${rawName}() is out of 32-bit range`, argsAt);
			return { $numberInt: String(n) };
		}
		case "NumberDecimal":
		case "Decimal128": {
			const arg = args[0];
			const text = typeof arg === "number" ? String(arg) : typeof arg === "string" ? arg : null;
			if (
				args.length !== 1 ||
				text === null ||
				!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$|^[+-]?(Infinity|Inf|NaN)$/.test(text.trim())
			) {
				sc.error(`${rawName}() takes a decimal number, preferably as a string`, argsAt);
			}
			return { $numberDecimal: text.trim() };
		}
		case "Double":
		case "NumberDouble": {
			const arg = args[0];
			const n = typeof arg === "number" ? arg : typeof arg === "string" ? Number(arg) : Number.NaN;
			if (args.length !== 1 || (Number.isNaN(n) && arg !== "NaN")) {
				sc.error(`${rawName}() takes a number`, argsAt);
			}
			if (!Number.isFinite(n)) {
				return { $numberDouble: Number.isNaN(n) ? "NaN" : n > 0 ? "Infinity" : "-Infinity" };
			}
			return { $numberDouble: Number.isInteger(n) ? `${n}.0` : String(n) };
		}
		case "Timestamp": {
			let t: EJsonValue | undefined = args[0];
			let i: EJsonValue | undefined = args[1];
			if (args.length === 1 && isObject(args[0])) {
				t = args[0].t;
				i = args[0].i;
			}
			if (
				typeof t !== "number" ||
				typeof i !== "number" ||
				!Number.isInteger(t) ||
				!Number.isInteger(i) ||
				t < 0 ||
				i < 0
			) {
				sc.error("Timestamp() takes (seconds, increment) or { t, i }", argsAt);
			}
			return { $timestamp: { t, i } };
		}
		case "BinData": {
			const [sub, data] = args;
			if (
				args.length !== 2 ||
				typeof sub !== "number" ||
				!Number.isInteger(sub) ||
				sub < 0 ||
				sub > 255 ||
				typeof data !== "string" ||
				!/^[A-Za-z0-9+/]*={0,2}$/.test(data)
			) {
				sc.error("BinData() takes (subtype, base64 string)", argsAt);
			}
			return { $binary: { base64: data, subType: sub.toString(16).padStart(2, "0") } };
		}
		case "UUID": {
			if (args.length === 0) {
				const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
				hex[12] = "4";
				hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
				const h = hex.join("");
				return {
					$uuid: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
				};
			}
			const text = stringArg(rawName, args, argsAt, sc);
			if (!UUID_RE.test(text)) sc.error("UUID() needs 32 hexadecimal characters", argsAt);
			const h = text.replace(/-/g, "").toLowerCase();
			return {
				$uuid: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
			};
		}
		case "HexData": {
			const [sub, hex] = args;
			if (
				args.length !== 2 ||
				typeof sub !== "number" ||
				typeof hex !== "string" ||
				!/^([0-9a-fA-F]{2})*$/.test(hex)
			) {
				sc.error("HexData() takes (subtype, hex string)", argsAt);
			}
			const bytes = hex.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? [];
			return {
				$binary: { base64: bytesToBase64(bytes), subType: sub.toString(16).padStart(2, "0") },
			};
		}
		case "RegExp": {
			const [pattern, flags] = args;
			if (typeof pattern !== "string" || (flags !== undefined && typeof flags !== "string")) {
				sc.error("RegExp() takes (pattern, flags?) as strings", argsAt);
			}
			return regexValue(pattern, flags ?? "", argsAt, sc);
		}
		case "MinKey":
			return { $minKey: 1 };
		case "MaxKey":
			return { $maxKey: 1 };
		default:
			return sc.error(`Unknown type "${rawName}()"`, start);
	}
}

/** Parse exactly one value; anything after it (other than whitespace, `;` or comments) is an error. */
export function parseLiteral(source: string): EJsonValue {
	const sc = new Scanner(source);
	const value = sc.value();
	sc.eat(";");
	if (!sc.done) sc.error(`Unexpected "${sc.peek()}" after the value`);
	return value;
}

/** Parse a value that must be a document. */
export function parseDocument(source: string, what = "document"): EJsonObject {
	const value = parseLiteral(source);
	if (!isObject(value)) throw new LiteralParseError(`Expected a ${what} ({ … })`, 0);
	return value;
}

/* ------------------------------------------------------------------ *
 * Rendering EJSON back into shell syntax
 * ------------------------------------------------------------------ */

const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * The shell spelling of an Extended JSON type wrapper, or null when `value` is an ordinary
 * document. Shared by the shell's output and the browser's editor, so a value round-trips:
 * what is printed can be pasted back in.
 */
export function shellTypeLiteral(value: EJsonObject): string | null {
	const keys = Object.keys(value);
	if (keys.length === 1) {
		const k = keys[0];
		const v = value[k];
		switch (k) {
			case "$oid":
				if (typeof v === "string") return `ObjectId(${JSON.stringify(v)})`;
				break;
			case "$date":
				if (typeof v === "string") return `ISODate(${JSON.stringify(v)})`;
				if (isObject(v) && typeof v.$numberLong === "string") {
					const d = new Date(Number(v.$numberLong));
					return Number.isNaN(d.getTime())
						? `Date(${v.$numberLong})`
						: `ISODate(${JSON.stringify(d.toISOString())})`;
				}
				if (typeof v === "number") return `ISODate(${JSON.stringify(new Date(v).toISOString())})`;
				break;
			case "$numberLong":
				if (typeof v === "string") return `NumberLong(${JSON.stringify(v)})`;
				break;
			case "$numberInt":
				if (typeof v === "string") return `NumberInt(${v})`;
				break;
			case "$numberDouble":
				if (typeof v === "string") return `Double(${JSON.stringify(v)})`;
				break;
			case "$numberDecimal":
				if (typeof v === "string") return `NumberDecimal(${JSON.stringify(v)})`;
				break;
			case "$uuid":
				if (typeof v === "string") return `UUID(${JSON.stringify(v)})`;
				break;
			case "$minKey":
				return "MinKey()";
			case "$maxKey":
				return "MaxKey()";
			case "$timestamp":
				if (isObject(v)) return `Timestamp({ t: ${v.t}, i: ${v.i} })`;
				break;
			case "$binary":
				if (isObject(v) && typeof v.base64 === "string") {
					const sub = Number.parseInt(String(v.subType ?? "0"), 16);
					return `BinData(${Number.isNaN(sub) ? 0 : sub}, ${JSON.stringify(v.base64)})`;
				}
				break;
			case "$regularExpression":
				if (isObject(v) && typeof v.pattern === "string") {
					const body = v.pattern.replace(/(^|[^\\])\//g, "$1\\/") || "(?:)";
					return `/${body}/${typeof v.options === "string" ? v.options : ""}`;
				}
				break;
			case "$symbol":
				if (typeof v === "string") return JSON.stringify(v);
				break;
			case "$code":
				if (typeof v === "string") return `Code(${JSON.stringify(v)})`;
				break;
		}
	}
	if (keys.length === 2 && "$code" in value && "$scope" in value) return "Code(…)";
	if ("$ref" in value && "$id" in value) return null;
	return null;
}

function quoteKey(key: string): string {
	return SIMPLE_KEY.test(key) ? key : JSON.stringify(key);
}

/**
 * Print a value in shell syntax: unquoted keys where possible, types as constructors.
 * `indent` > 0 pretty-prints; 0 prints on one line.
 */
export function toShell(value: EJsonValue, indent = 2, depth = 0): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") {
		if (Number.isNaN(value)) return "NaN";
		if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
		return String(value);
	}
	if (typeof value === "boolean") return String(value);
	const pad = indent > 0 ? `\n${" ".repeat(indent * (depth + 1))}` : " ";
	const close = indent > 0 ? `\n${" ".repeat(indent * depth)}` : " ";
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const items = value.map((v) => toShell(v, indent, depth + 1));
		const flat = `[ ${items.join(", ")} ]`;
		if (indent === 0 || (flat.length <= 72 && !flat.includes("\n"))) return flat;
		return `[${pad}${items.join(`,${pad}`)}${close}]`;
	}
	const literal = shellTypeLiteral(value);
	if (literal !== null) return literal;
	const entries = Object.entries(value);
	if (entries.length === 0) return "{}";
	const items = entries.map(([k, v]) => `${quoteKey(k)}: ${toShell(v, indent, depth + 1)}`);
	const flat = `{ ${items.join(", ")} }`;
	if (indent === 0 || (flat.length <= 72 && !flat.includes("\n"))) return flat;
	return `{${pad}${items.join(`,${pad}`)}${close}}`;
}

/** A short, human label for a BSON type as it appears in Extended JSON. */
export function bsonTypeOf(value: EJsonValue | undefined): string {
	if (value === undefined) return "missing";
	if (value === null) return "null";
	if (typeof value === "string") return "string";
	if (typeof value === "boolean") return "bool";
	if (typeof value === "number") return Number.isInteger(value) ? "int" : "double";
	if (Array.isArray(value)) return "array";
	const keys = Object.keys(value);
	if (keys.length === 1) {
		switch (keys[0]) {
			case "$oid":
				return "objectId";
			case "$date":
				return "date";
			case "$numberLong":
				return "long";
			case "$numberInt":
				return "int";
			case "$numberDouble":
				return "double";
			case "$numberDecimal":
				return "decimal";
			case "$binary":
			case "$uuid":
				return "binData";
			case "$regularExpression":
				return "regex";
			case "$timestamp":
				return "timestamp";
			case "$minKey":
				return "minKey";
			case "$maxKey":
				return "maxKey";
			case "$code":
				return "javascript";
			case "$symbol":
				return "symbol";
		}
	}
	return "object";
}

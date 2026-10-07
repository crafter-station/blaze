/**
 * Split a console line into arguments exactly the way redis-cli does (`sdssplitargs`):
 *
 * - arguments are separated by whitespace;
 * - `"double quotes"` support escapes: `\n \r \t \b \a \\ \"` and `\xHH` for any byte;
 * - `'single quotes'` are literal except for `\'`;
 * - a quote may open mid-argument (`a"b c"` is `ab c`), as in redis-cli;
 * - a closing quote must be followed by whitespace or the end of the line, and an
 *   unterminated quote is an error ("Invalid argument(s)" in redis-cli).
 *
 * Arguments are bytes, not strings: `"\xff"` is one byte that is not valid UTF-8, and has
 * to reach Redis as that byte. Each token also keeps its source span so the editor can
 * place hints and completions.
 */

export interface Token {
	/** Bytes sent to Redis. */
	bytes: Uint8Array;
	/** The argument as text, for matching and display (lossy for non-UTF-8 bytes). */
	text: string;
	/** Source span in the line, quotes included. */
	from: number;
	to: number;
	quoted: boolean;
}

export interface TokenizeResult {
	tokens: Token[];
	/** Set when the line cannot be split (unbalanced quotes). */
	error?: string;
	/** True when the line ends inside an unterminated quote; the last token is partial. */
	open?: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const isSpace = (ch: string) =>
	ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\v" || ch === "\f";
const isHex = (ch: string | undefined) => !!ch && /^[0-9a-fA-F]$/.test(ch);

export function tokenize(line: string): TokenizeResult {
	const tokens: Token[] = [];
	let i = 0;
	const n = line.length;

	while (i < n) {
		while (i < n && isSpace(line[i])) i++;
		if (i >= n) break;

		const from = i;
		const bytes: number[] = [];
		const pushText = (text: string) => {
			for (const b of encoder.encode(text)) bytes.push(b);
		};
		let inDouble = false;
		let inSingle = false;
		let quoted = false;
		let done = false;

		while (!done) {
			if (inDouble) {
				if (i >= n) {
					return {
						tokens: [...tokens, finish(bytes, from, i, true)],
						error: "Unbalanced quotes",
						open: true,
					};
				}
				const ch = line[i];
				if (ch === "\\" && line[i + 1] === "x" && isHex(line[i + 2]) && isHex(line[i + 3])) {
					bytes.push(Number.parseInt(line.slice(i + 2, i + 4), 16));
					i += 4;
				} else if (ch === "\\" && i + 1 < n) {
					const next = line[i + 1];
					const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", a: "\x07" };
					pushText(map[next] ?? next);
					i += 2;
				} else if (ch === '"') {
					i++;
					// The closing quote must be followed by a space or nothing.
					if (i < n && !isSpace(line[i])) {
						return { tokens, error: "Closing quote must be followed by a space" };
					}
					done = true;
				} else {
					pushText(ch);
					i++;
				}
			} else if (inSingle) {
				if (i >= n) {
					return {
						tokens: [...tokens, finish(bytes, from, i, true)],
						error: "Unbalanced quotes",
						open: true,
					};
				}
				const ch = line[i];
				if (ch === "\\" && line[i + 1] === "'") {
					bytes.push(39);
					i += 2;
				} else if (ch === "'") {
					i++;
					if (i < n && !isSpace(line[i])) {
						return { tokens, error: "Closing quote must be followed by a space" };
					}
					done = true;
				} else {
					pushText(ch);
					i++;
				}
			} else {
				if (i >= n) {
					done = true;
					break;
				}
				const ch = line[i];
				if (isSpace(ch)) {
					done = true;
				} else if (ch === '"') {
					inDouble = true;
					quoted = true;
					i++;
				} else if (ch === "'") {
					inSingle = true;
					quoted = true;
					i++;
				} else {
					// Code points, not UTF-16 units: an emoji is one character here.
					const cp = line.codePointAt(i) ?? 0;
					const char = String.fromCodePoint(cp);
					pushText(char);
					i += char.length;
				}
			}
		}
		tokens.push(finish(bytes, from, i, quoted));
	}
	return { tokens };
}

function finish(bytes: number[], from: number, to: number, quoted: boolean): Token {
	const array = Uint8Array.from(bytes);
	return { bytes: array, text: decoder.decode(array), from, to, quoted };
}

/**
 * Quote one argument so that `tokenize` reads it back byte for byte: bare when it is
 * plain printable text, otherwise double-quoted with escapes, as redis-cli prints it.
 */
export function quoteArg(value: string | Uint8Array): string {
	const bytes = typeof value === "string" ? encoder.encode(value) : value;
	const text = typeof value === "string" ? value : decoder.decode(value);
	const plain =
		bytes.length > 0 &&
		typeof value === "string" &&
		!/[\s"'\\]/.test(text) &&
		// Control characters need escapes; everything else printable (including UTF-8) is fine.
		![...text].some((ch) => (ch.codePointAt(0) ?? 0) < 0x20 || ch === "\x7f");
	if (plain) return text;
	return `"${escapeBytes(bytes)}"`;
}

/** redis-cli's `sdscatrepr`: printable ASCII as-is, common escapes, `\xHH` otherwise. */
export function escapeBytes(bytes: Uint8Array, keepUtf8 = true): string {
	if (keepUtf8) {
		try {
			const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			let out = "";
			for (const ch of text) {
				const code = ch.codePointAt(0) ?? 0;
				if (ch === "\\") out += "\\\\";
				else if (ch === '"') out += '\\"';
				else if (ch === "\n") out += "\\n";
				else if (ch === "\r") out += "\\r";
				else if (ch === "\t") out += "\\t";
				else if (ch === "\x07") out += "\\a";
				else if (ch === "\b") out += "\\b";
				else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}`;
				else out += ch;
			}
			return out;
		} catch {
			// Not UTF-8: fall through to the byte-wise form.
		}
	}
	let out = "";
	for (const b of bytes) {
		if (b === 0x5c) out += "\\\\";
		else if (b === 0x22) out += '\\"';
		else if (b === 0x0a) out += "\\n";
		else if (b === 0x0d) out += "\\r";
		else if (b === 0x09) out += "\\t";
		else if (b === 0x07) out += "\\a";
		else if (b === 0x08) out += "\\b";
		else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
		else out += `\\x${b.toString(16).padStart(2, "0")}`;
	}
	return out;
}

/** Split a multi-line console input into runnable lines, skipping blanks and `#` comments. */
export function commandLines(input: string): { line: string; index: number }[] {
	return input
		.split(/\r?\n/)
		.map((line, index) => ({ line: line.trim(), index }))
		.filter(({ line }) => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"));
}

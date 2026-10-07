import { describe, expect, test } from "bun:test";
import { commandLines, escapeBytes, quoteArg, tokenize } from "./tokenize";

const texts = (line: string) => tokenize(line).tokens.map((t) => t.text);
const bytes = (line: string) => tokenize(line).tokens.map((t) => [...t.bytes]);

describe("tokenize", () => {
	test("splits on any whitespace and ignores runs of it", () => {
		expect(texts("  SET   key\tvalue  ")).toEqual(["SET", "key", "value"]);
		expect(texts("")).toEqual([]);
		expect(texts("   ")).toEqual([]);
	});

	test("double quotes keep spaces and process escapes", () => {
		expect(texts('SET k "hello world"')).toEqual(["SET", "k", "hello world"]);
		expect(texts('SET k "a\\nb\\tc\\\\d\\"e"')).toEqual(["SET", "k", 'a\nb\tc\\d"e']);
		expect(texts('SET k "\\a\\b\\r"')).toEqual(["SET", "k", "\x07\b\r"]);
	});

	test("\\xHH produces raw bytes, including ones that are not UTF-8", () => {
		expect(bytes('SET k "\\xff\\x00A"')[2]).toEqual([0xff, 0x00, 0x41]);
		// An incomplete \x escape is just an escaped x.
		expect(texts('SET k "\\xZZ"')[2]).toBe("xZZ");
	});

	test("single quotes are literal except for an escaped single quote", () => {
		expect(texts("SET k 'a \\n b'")).toEqual(["SET", "k", "a \\n b"]);
		expect(texts("SET k 'it\\'s'")).toEqual(["SET", "k", "it's"]);
	});

	test("quotes can open mid-argument, as in redis-cli", () => {
		expect(texts('SET k a"b c"')).toEqual(["SET", "k", "ab c"]);
	});

	test("empty quoted strings are real (empty) arguments", () => {
		expect(texts('SET k ""')).toEqual(["SET", "k", ""]);
		expect(texts("SET k ''")).toEqual(["SET", "k", ""]);
	});

	test("unicode is UTF-8 encoded", () => {
		expect(bytes("SET k é")[2]).toEqual([0xc3, 0xa9]);
		expect(texts("SET k 🔥x")[2]).toBe("🔥x");
	});

	test("unbalanced quotes are an error, with the partial token marked open", () => {
		const result = tokenize('SET k "unterminated');
		expect(result.error).toBe("Unbalanced quotes");
		expect(result.open).toBe(true);
		expect(result.tokens.at(-1)?.text).toBe("unterminated");
		expect(tokenize("SET k 'oops").error).toBe("Unbalanced quotes");
	});

	test("a closing quote glued to more text is an error", () => {
		expect(tokenize('SET "k"v x').error).toMatch(/followed by a space/);
	});

	test("records each token's source span", () => {
		const { tokens } = tokenize('GET  "a b"');
		expect(tokens.map((t) => [t.from, t.to, t.quoted])).toEqual([
			[0, 3, false],
			[5, 10, true],
		]);
	});
});

describe("quoteArg", () => {
	test("leaves plain words bare and quotes the rest", () => {
		expect(quoteArg("user:42")).toBe("user:42");
		expect(quoteArg("hello world")).toBe('"hello world"');
		expect(quoteArg("")).toBe('""');
		expect(quoteArg('say "hi"')).toBe('"say \\"hi\\""');
		expect(quoteArg("a\nb")).toBe('"a\\nb"');
		expect(quoteArg("café")).toBe("café");
	});

	test("round-trips through tokenize byte for byte", () => {
		const samples: (string | Uint8Array)[] = [
			"plain",
			"two words",
			'quote " and \\ backslash',
			"tab\tnew\nline",
			"",
			"ünïcødé ✓",
			new Uint8Array([0xff, 0x00, 0x22, 0x5c, 0x41]),
		];
		for (const sample of samples) {
			const quoted = quoteArg(sample);
			const [token] = tokenize(quoted).tokens;
			const expected = typeof sample === "string" ? new TextEncoder().encode(sample) : sample;
			expect([...(token?.bytes ?? [])]).toEqual([...expected]);
		}
	});
});

describe("escapeBytes", () => {
	test("prints non-UTF-8 bytes as \\xHH", () => {
		expect(escapeBytes(new Uint8Array([0x61, 0xff, 0x0a]))).toBe("a\\xff\\n");
	});
});

describe("commandLines", () => {
	test("drops blank lines and comments, keeping source line numbers", () => {
		expect(commandLines("PING\n\n# note\n  GET a  \n// also\nDBSIZE")).toEqual([
			{ line: "PING", index: 0 },
			{ line: "GET a", index: 3 },
			{ line: "DBSIZE", index: 5 },
		]);
	});
});

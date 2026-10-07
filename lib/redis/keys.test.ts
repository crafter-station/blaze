import { describe, expect, test } from "bun:test";
import { decodeKeyRef, encodeKeyRef, formatTtl, inspectCommand, keyArg, keyLabel } from "./keys";

const enc = new TextEncoder();

describe("key refs", () => {
	test("UTF-8 keys travel as themselves", () => {
		expect(encodeKeyRef(enc.encode("user:1"))).toBe("user:1");
		expect([...decodeKeyRef("café")]).toEqual([...enc.encode("café")]);
	});

	test("binary keys and NUL-prefixed keys round-trip through base64", () => {
		for (const bytes of [Uint8Array.from([0xff, 0x00, 0x41]), enc.encode("\u0000b64:trick")]) {
			const ref = encodeKeyRef(bytes);
			expect(ref.startsWith("\u0000b64:")).toBe(true);
			expect([...decodeKeyRef(ref)]).toEqual([...bytes]);
		}
	});

	test("labels and console arguments are escaped", () => {
		const ref = encodeKeyRef(Uint8Array.from([0x61, 0xff]));
		expect(keyLabel(ref)).toBe("a\\xff");
		expect(keyArg(ref)).toBe('"a\\xff"');
		expect(keyArg("my key")).toBe('"my key"');
		expect(inspectCommand("hash", "user:1")).toBe("HGETALL user:1");
	});
});

describe("formatTtl", () => {
	test("prints compact durations", () => {
		expect(formatTtl(-1)).toBe("No expiry");
		expect(formatTtl(500)).toBe("500 ms");
		expect(formatTtl(42_000)).toBe("42s");
		expect(formatTtl(200_000)).toBe("3m 20s");
		expect(formatTtl(7_500_000)).toBe("2h 5m");
		expect(formatTtl(90_000_000)).toBe("1d 1h");
	});
});

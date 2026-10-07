import { encodeKeyRef } from "./keys";
import { escapeBytes } from "./tokenize";
import type { ValueText } from "./types";

/**
 * A stored value as the browser shows it: UTF-8 text when it is text, the redis-cli
 * escaped form plus hex when it is not, cut at `maxBytes`. Values small enough to edit or
 * to name in a command (a hash field, a set member) also carry `ref`, their exact bytes
 * in transport form.
 */

const strict = new TextDecoder("utf-8", { fatal: true });

/** Largest value that carries its exact bytes back to the browser. */
export const MAX_REF_BYTES = 64_000;

function hex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

export function valueText(bytes: Uint8Array, maxBytes = 256_000): ValueText {
	const truncated = bytes.length > maxBytes;
	let shown = truncated ? bytes.subarray(0, maxBytes) : bytes;
	const ref = bytes.length <= MAX_REF_BYTES ? encodeKeyRef(bytes) : "";
	try {
		return {
			text: strict.decode(shown),
			bytes: bytes.length,
			ref,
			...(truncated && { truncated }),
		};
	} catch {
		if (truncated) {
			// A cut can split a character; back off up to three bytes before calling it binary.
			for (let back = 1; back <= 3; back++) {
				try {
					return {
						text: strict.decode(shown.subarray(0, shown.length - back)),
						bytes: bytes.length,
						ref,
						truncated,
					};
				} catch {}
			}
			shown = shown.subarray(0, Math.min(shown.length, 64_000));
		}
		return {
			text: escapeBytes(shown, false),
			binary: true,
			hex: hex(shown),
			bytes: bytes.length,
			ref,
			...(truncated && { truncated }),
		};
	}
}

/** JSON pretty-printed when the text is a JSON object or array, else null. */
export function prettyJson(text: string): string | null {
	const trimmed = text.trim();
	if (!/^[[{]/.test(trimmed)) return null;
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return null;
	}
}

/** Rows of a classic hex dump: offset, 16 bytes in hex, and their printable ASCII. */
export function hexDump(
	hexString: string,
	width = 16,
): { offset: string; hex: string; ascii: string }[] {
	const rows: { offset: string; hex: string; ascii: string }[] = [];
	for (let i = 0; i < hexString.length; i += width * 2) {
		const chunk = hexString.slice(i, i + width * 2);
		const bytes = chunk.match(/../g) ?? [];
		rows.push({
			offset: (i / 2).toString(16).padStart(8, "0"),
			hex: bytes.join(" "),
			ascii: bytes
				.map((b) => {
					const code = Number.parseInt(b, 16);
					return code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : ".";
				})
				.join(""),
		});
	}
	return rows;
}

/** Bytes from text typed in an editor; `\xHH`-escaped input becomes raw bytes when asked. */
export function textBytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

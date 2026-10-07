/**
 * Command reference for the console's completion and argument hints.
 *
 * Built at runtime from `COMMAND DOCS`, so it describes exactly the server the tenant is
 * connected to, module commands (`JSON.SET`, `FT.SEARCH`, `TS.ADD`) included, rather than
 * a bundled list that drifts out of date. The hint is what redis-cli prints after the
 * cursor: the arguments still to come, given the ones already typed.
 */

export interface ArgSpec {
	name: string;
	type: string;
	/** Literal word the argument starts with, e.g. `EX`, `MATCH`. */
	token?: string;
	display?: string;
	optional?: boolean;
	multiple?: boolean;
	/** The token repeats with every value (`GET pattern GET pattern`). */
	multipleToken?: boolean;
	args?: ArgSpec[];
}

export interface CommandSpec {
	/** Upper case; container subcommands are `"CLIENT LIST"`. */
	name: string;
	summary?: string;
	group?: string;
	since?: string;
	complexity?: string;
	module?: string;
	deprecated?: boolean;
	args: ArgSpec[];
	/** For container commands (CLIENT, XINFO, ...): their subcommand names, upper case. */
	subcommands?: string[];
}

export type CommandIndex = Record<string, CommandSpec>;

type Loose = unknown;

/** Pairs from a RESP3 map (decoded to an object) or a RESP2 flat array. */
function entries(value: Loose): [string, Loose][] {
	if (Array.isArray(value)) {
		const out: [string, Loose][] = [];
		for (let i = 0; i + 1 < value.length; i += 2) out.push([String(value[i]), value[i + 1]]);
		return out;
	}
	if (value && typeof value === "object") return Object.entries(value as Record<string, Loose>);
	return [];
}

function field(value: Loose, name: string): Loose {
	for (const [k, v] of entries(value)) if (k === name) return v;
	return undefined;
}

function str(value: Loose): string | undefined {
	return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

function list(value: Loose): Loose[] {
	return Array.isArray(value) ? value : [];
}

function parseArg(raw: Loose): ArgSpec {
	const flags = list(field(raw, "flags")).map((f) => String(f));
	const nested = list(field(raw, "arguments")).map(parseArg);
	const arg: ArgSpec = {
		name: str(field(raw, "name")) ?? "arg",
		type: str(field(raw, "type")) ?? "string",
	};
	const token = str(field(raw, "token"));
	const display = str(field(raw, "display_text"));
	if (token) arg.token = token;
	if (display) arg.display = display;
	if (flags.includes("optional")) arg.optional = true;
	if (flags.includes("multiple")) arg.multiple = true;
	if (flags.includes("multiple_token")) arg.multipleToken = true;
	if (nested.length) arg.args = nested;
	return arg;
}

function parseCommand(name: string, raw: Loose, index: CommandIndex) {
	const spec: CommandSpec = {
		name: name.toUpperCase(),
		args: list(field(raw, "arguments")).map(parseArg),
	};
	const summary = str(field(raw, "summary"));
	const group = str(field(raw, "group"));
	const since = str(field(raw, "since"));
	const complexity = str(field(raw, "complexity"));
	const module = str(field(raw, "module"));
	if (summary) spec.summary = summary;
	if (group) spec.group = group;
	if (since) spec.since = since;
	if (complexity) spec.complexity = complexity;
	if (module) spec.module = module;
	const flags = list(field(raw, "doc_flags")).map(String);
	if (flags.includes("deprecated") || field(raw, "deprecated_since")) spec.deprecated = true;

	const subs = entries(field(raw, "subcommands"));
	if (subs.length) {
		spec.subcommands = [];
		for (const [subName, subRaw] of subs) {
			// Docs name subcommands `client|list`.
			const [, sub = subName] = subName.split("|");
			spec.subcommands.push(sub.toUpperCase());
			parseCommand(`${name} ${sub}`, subRaw, index);
		}
		spec.subcommands.sort();
	}
	index[spec.name] = spec;
}

/** `COMMAND DOCS` reply, decoded to plain JS (see `respToJs`), as an index by name. */
export function parseCommandDocs(docs: Loose): CommandIndex {
	const index: CommandIndex = {};
	for (const [name, raw] of entries(docs)) parseCommand(name, raw, index);
	return index;
}

/* ------------------------------------------------------------------ *
 * Rendering argument syntax
 * ------------------------------------------------------------------ */

function valueName(arg: ArgSpec): string {
	return arg.display ?? arg.name;
}

/** One argument as the docs print it: `[EX seconds | PX milliseconds]`, `key [key ...]`. */
export function renderArg(arg: ArgSpec, bare = false): string {
	let body: string;
	if (arg.type === "pure-token") body = arg.token ?? arg.name;
	else if (arg.type === "oneof") body = (arg.args ?? []).map((a) => renderArg(a)).join(" | ");
	else if (arg.type === "block") body = (arg.args ?? []).map((a) => renderArg(a)).join(" ");
	else body = valueName(arg);

	if (arg.token && arg.type !== "pure-token") body = `${arg.token} ${body}`;
	if (arg.multiple) {
		const again = arg.multipleToken || !arg.token ? body : body.slice(arg.token.length + 1);
		body = `${body} [${again} ...]`;
	}
	if (arg.optional && !bare) return `[${body}]`;
	if (arg.type === "oneof" && !arg.optional && !bare) return `<${body}>`;
	return body;
}

export function renderSyntax(spec: CommandSpec): string {
	return [spec.name, ...spec.args.map((a) => renderArg(a))].join(" ");
}

/* ------------------------------------------------------------------ *
 * Matching typed arguments against the spec
 * ------------------------------------------------------------------ */

interface Match {
	/** Tokens consumed. */
	used: number;
	/** Rendered pieces still to come, in order. */
	rest: string[];
	/** Literal tokens that may come next. */
	expect: string[];
	/** True when a plain value (not a fixed word) may come next. */
	expectValue: boolean;
	/** Names of value arguments matched so far, by token position (for key detection). */
	kinds: (string | null)[];
}

const eq = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

/** Fixed words an argument can start with; empty when it starts with a free value. */
function firstTokens(arg: ArgSpec): string[] {
	if (arg.token) return [arg.token];
	if (arg.type === "oneof") return (arg.args ?? []).flatMap(firstTokens);
	if (arg.type === "block") {
		const out: string[] = [];
		for (const sub of arg.args ?? []) {
			out.push(...firstTokens(sub));
			if (!sub.optional) break;
		}
		return out;
	}
	return [];
}

function startsWithValue(arg: ArgSpec): boolean {
	if (arg.token) return false;
	if (arg.type === "oneof") return (arg.args ?? []).some(startsWithValue);
	if (arg.type === "block") {
		for (const sub of arg.args ?? []) {
			if (startsWithValue(sub)) return true;
			if (!sub.optional) return false;
		}
		return false;
	}
	return arg.type !== "pure-token";
}

/**
 * Try to consume `arg` once at `tokens[i]`. Returns null when it does not apply there.
 * `partial` marks that tokens ran out inside the argument, with what remains of it.
 */
function matchOnce(
	arg: ArgSpec,
	tokens: string[],
	i: number,
	kinds: (string | null)[],
): { next: number; partial?: Match } | null {
	if (i >= tokens.length) return null;
	let at = i;
	if (arg.token) {
		if (!eq(tokens[at], arg.token)) return null;
		kinds[at] = null;
		at++;
		if (arg.type === "pure-token") return { next: at };
		if (at >= tokens.length) {
			// The word is typed; its value is not.
			const inner: ArgSpec = { ...arg, token: undefined, optional: false, multiple: false };
			return {
				next: at,
				partial: {
					used: at,
					rest: [renderArg(inner, true)],
					expect: firstTokens(inner),
					expectValue: startsWithValue(inner),
					kinds,
				},
			};
		}
	}
	if (arg.type === "oneof") {
		for (const alt of arg.args ?? []) {
			const result = matchOnce(alt, tokens, at, kinds);
			if (result) return result;
		}
		return null;
	}
	if (arg.type === "block") {
		const result = matchSequence(arg.args ?? [], tokens, at, kinds);
		if (result.used === at && !(arg.args ?? []).every((a) => a.optional)) return null;
		if (result.used >= tokens.length && (result.rest.length || result.partialInside)) {
			return { next: result.used, partial: { ...result, kinds } };
		}
		return { next: result.used };
	}
	if (arg.type === "pure-token") return null;
	kinds[at] = arg.type === "key" ? "key" : arg.type;
	return { next: at + 1 };
}

function matchSequence(
	args: ArgSpec[],
	tokens: string[],
	start: number,
	kinds: (string | null)[],
): Match & { partialInside?: boolean } {
	let i = start;
	for (let k = 0; k < args.length; k++) {
		const arg = args[k];
		if (i >= tokens.length) {
			// Out of tokens: everything from here on is still to come.
			const expect: string[] = [];
			let expectValue = false;
			for (let j = k; j < args.length; j++) {
				expect.push(...firstTokens(args[j]));
				if (startsWithValue(args[j])) expectValue = true;
				if (!args[j].optional) break;
			}
			return { used: i, rest: args.slice(k).map((a) => renderArg(a)), expect, expectValue, kinds };
		}
		const first = matchOnce(arg, tokens, i, kinds);
		if (!first) {
			if (arg.optional) continue;
			// A required argument that does not fit: stop hinting rather than guess.
			return { used: i, rest: [], expect: [], expectValue: false, kinds };
		}
		if (first.partial) {
			const after = args.slice(k + 1).map((a) => renderArg(a));
			const again = arg.multiple
				? [`[${renderArg({ ...arg, optional: false, multiple: false }, true)} ...]`]
				: [];
			return {
				...first.partial,
				rest: [...first.partial.rest, ...again, ...after],
				partialInside: true,
			};
		}
		i = first.next;
		if (arg.multiple) {
			for (;;) {
				if (i >= tokens.length) {
					// Another repetition may follow, then whatever comes after.
					const repeat = renderArg({ ...arg, optional: false, multiple: false }, true);
					const expect = [...firstTokens(arg)];
					let expectValue = startsWithValue(arg);
					for (let j = k + 1; j < args.length; j++) {
						expect.push(...firstTokens(args[j]));
						if (startsWithValue(args[j])) expectValue = true;
						if (!args[j].optional) break;
					}
					return {
						used: i,
						rest: [`[${repeat} ...]`, ...args.slice(k + 1).map((a) => renderArg(a))],
						expect,
						expectValue,
						kinds,
					};
				}
				// A repeated free value would swallow everything; let a following fixed word win.
				const nextWord = args
					.slice(k + 1)
					.some((a) => firstTokens(a).some((t) => eq(t, tokens[i])));
				if (nextWord) break;
				const more = matchOnce(arg, tokens, i, kinds);
				if (!more || more.next === i) break;
				if (more.partial) {
					return {
						...more.partial,
						rest: [...more.partial.rest, ...args.slice(k + 1).map((a) => renderArg(a))],
					};
				}
				i = more.next;
			}
		}
	}
	return { used: i, rest: [], expect: [], expectValue: false, kinds };
}

export interface HintResult {
	spec: CommandSpec;
	/** Remaining syntax, e.g. `value [NX | XX] [GET] ...`; empty when complete. */
	hint: string;
	/** Fixed words that may come next (for completion). */
	expect: string[];
	/** Whether a free value may come next. */
	expectValue: boolean;
	/** Per argument (after the command words): `"key"` for key arguments, else a type or null. */
	argKinds: (string | null)[];
	/** How many leading words name the command (2 for `CLIENT LIST`). */
	commandWords: number;
}

/** Resolve `CLIENT LIST` style commands to the most specific spec. */
export function lookupCommand(
	index: CommandIndex,
	words: string[],
): { spec: CommandSpec; words: number } | null {
	if (words.length === 0) return null;
	const first = words[0].toUpperCase();
	const top = index[first];
	if (!top) return null;
	if (top.subcommands?.length && words.length > 1) {
		const sub = index[`${first} ${words[1].toUpperCase()}`];
		if (sub) return { spec: sub, words: 2 };
	}
	return { spec: top, words: 1 };
}

/**
 * The hint for a line whose arguments so far are `words` (command name first). Every
 * word counts as typed, including one the cursor is still in, which is how redis-cli
 * behaves: `SET k` hints `value [NX | XX] ...`.
 */
export function commandHint(index: CommandIndex, words: string[]): HintResult | null {
	const found = lookupCommand(index, words);
	if (!found) return null;
	const { spec, words: commandWords } = found;
	if (spec.subcommands?.length && words.length === commandWords) {
		return {
			spec,
			hint: `<${spec.subcommands.slice(0, 8).join(" | ")}${spec.subcommands.length > 8 ? " | ..." : ""}>`,
			expect: spec.subcommands,
			expectValue: false,
			argKinds: [],
			commandWords,
		};
	}
	const args = words.slice(commandWords);
	const kinds: (string | null)[] = new Array(args.length).fill(null);
	const match = matchSequence(spec.args, args, 0, kinds);
	return {
		spec,
		hint: match.rest.join(" "),
		expect: [...new Set(match.expect.map((t) => t.toUpperCase()))],
		expectValue: match.expectValue,
		argKinds: kinds,
		commandWords,
	};
}

/** Which arguments of a typed command are key names, by position in `words`. */
export function keyPositions(index: CommandIndex, words: string[]): number[] {
	const result = commandHint(index, words);
	if (!result) return [];
	const out: number[] = [];
	result.argKinds.forEach((kind, i) => {
		if (kind === "key") out.push(i + result.commandWords);
	});
	return out;
}

/* ------------------------------------------------------------------ *
 * Fallback names when COMMAND DOCS is unavailable
 * ------------------------------------------------------------------ */

/** Minimal index from `COMMAND LIST`: names only, no syntax. */
export function indexFromNames(names: string[]): CommandIndex {
	const index: CommandIndex = {};
	for (const name of names) {
		const [top, sub] = name.toUpperCase().split("|");
		if (sub) {
			index[`${top} ${sub}`] = { name: `${top} ${sub}`, args: [] };
			index[top] ??= { name: top, args: [], subcommands: [] };
			const parent = index[top];
			parent.subcommands = [...(parent.subcommands ?? []), sub].sort();
		} else {
			index[top] ??= { name: top, args: [] };
		}
	}
	return index;
}

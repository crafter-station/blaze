/**
 * Drives the Redis key Browser and Console end to end against the local Redis from
 * docker-compose.dev.yaml (see README → "Local Redis").
 *
 *   node --env-file=.env.local e2e/redis-console.mjs --out <dir>
 *        [--modes dark,light] [--widths 1440,390] [--only flow,flow]
 *
 * Signs in the dedicated test user with a Clerk testing token, then covers: the namespace
 * tree and flat list, every type viewer, the console (completion, hints, multi-line runs,
 * blocked and blocking commands, the delete confirmation), cross-links between the two,
 * and, once (the first mode and width): editing every type, TTL, rename, delete, bulk
 * delete, the full-database error and Ask AI against e2e/mock-openai.ts.
 *
 * Writes only `e2e:*` keys, and the `fill:*` keys of the full-database check, and removes
 * them again. The full-database check fills the *local* Redis directly and refuses to run
 * against anything else.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { chromium } from "@playwright/test";
import Redis from "ioredis";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};
const out = flag("out", "e2e/screens-redis");
const base = flag("base", "http://localhost:3000");
const modes = flag("modes", "dark,light").split(",");
const widths = flag("widths", "1440,390").split(",").map(Number);
const only = flag("only", "")?.split(",").filter(Boolean);
const email = process.env.E2E_EMAIL ?? "blaze-ui-test+clerk_test@example.com";
const DB = "db_cachedevrds2";
const browserUrl = `${base}/databases/${DB}/browser`;
const consoleUrl = `${base}/databases/${DB}/console`;

mkdirSync(out, { recursive: true });
process.env.CLERK_PUBLISHABLE_KEY ??= process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
await clerkSetup();

const failures = [];
const log = (...m) => console.log(...m);
const run = (flow) => !only?.length || only.includes(flow);

function check(condition, message) {
	if (!condition) {
		failures.push(message);
		log("   FAIL", message);
	} else log("   ok  ", message);
}

/** The local Redis, as the tenant. Only ever 127.0.0.1. */
function localRedis() {
	return new Redis({
		host: "127.0.0.1",
		port: 63791,
		username: "default",
		password: "devpassword-cache",
		tls: { rejectUnauthorized: false },
		lazyConnect: true,
		maxRetriesPerRequest: 1,
	});
}

async function cleanup() {
	const redis = localRedis();
	await redis.connect();
	for (const pattern of ["e2e:*", "fill:*"]) {
		let cursor = "0";
		do {
			const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 1000);
			cursor = next;
			if (keys.length) await redis.unlink(...keys);
		} while (cursor !== "0");
	}
	redis.disconnect();
}

const browser = await chromium.launch();
let firstPass = true;
await cleanup();

for (const mode of modes) {
	for (const width of widths) {
		const mobile = width < 600;
		const tag = `${mode}.${width}`;
		const context = await browser.newContext({
			viewport: { width, height: mobile ? 844 : 900 },
			deviceScaleFactor: mobile ? 2 : 1,
			colorScheme: mode,
		});
		await context.addInitScript(() => {
			document.addEventListener("DOMContentLoaded", () => {
				const style = document.createElement("style");
				style.textContent = "nextjs-portal{display:none!important}";
				document.head.append(style);
			});
		});
		await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
		const page = await context.newPage();
		page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
		const shot = async (name) => {
			await page.waitForTimeout(350);
			const file = join(out, `${name}.${tag}.png`);
			await page.screenshot({ path: file });
			log("  ", file);
		};
		await page.goto(`${base}/sign-in`);
		await clerk.signIn({ page, emailAddress: email });
		log(`redis · ${tag}`);

		const openKeys = async () => {
			if (mobile) {
				await page.getByRole("button", { name: /^Keys/ }).click();
				await page.waitForTimeout(400);
			}
		};
		const closeKeys = async () => {
			if (mobile) await page.keyboard.press("Escape");
		};
		const openKey = async (key) => {
			await page.goto(`${browserUrl}?key=${encodeURIComponent(key)}`, { waitUntil: "networkidle", timeout: 90_000 });
			await page.getByRole("heading", { name: key }).waitFor({ timeout: 20_000 });
			await page.waitForTimeout(500);
		};
		const input = page.locator(".cm-content").first();
		const typeLine = async (text) => {
			await page.keyboard.type(text);
			await page.keyboard.press("Escape");
		};
		const freshConsole = async () => {
			await page.goto(consoleUrl, { waitUntil: "networkidle", timeout: 90_000 });
			await page.evaluate((key) => localStorage.removeItem(key), `blaze.redis.tabs.${DB}`);
			await page.reload({ waitUntil: "networkidle" });
			await input.click();
			await page.keyboard.press("Control+l");
		};

		/* ---------------- browser: tree, flat, filter ---------------- */

		if (run("tree")) {
			await page.goto(browserUrl, { waitUntil: "networkidle", timeout: 90_000 });
			await page.getByText("Memory").first().waitFor();
			await openKeys();
			await page.getByRole("treeitem").first().waitFor({ timeout: 20_000 });
			check((await page.getByRole("treeitem").count()) > 5, "browser: namespace tree renders folders");
			await page.getByRole("treeitem").filter({ hasText: /^user/ }).first().click();
			await page.waitForTimeout(400);
			check(
				(await page.locator('[role="treeitem"][aria-level="2"]').count()) > 0,
				"browser: expanding a folder shows its children",
			);
			await shot("browser-tree");
			await page.getByRole("radio", { name: "Flat list" }).click();
			await page.waitForTimeout(400);
			check(
				(await page.getByRole("treeitem").filter({ hasText: "cache:product" }).count()) > 0,
				"browser: flat list shows full key names",
			);
			await shot("browser-flat");
			await page.getByRole("radio", { name: "Namespace tree" }).click();
			await closeKeys();

			await page.goto(`${browserUrl}?q=leaderboard&type=zset`, { waitUntil: "networkidle" });
			await openKeys();
			await page.waitForTimeout(1200);
			const rows = await page.getByRole("treeitem").allInnerTexts();
			check(rows.length > 0 && rows.join(" ").includes("leaderboard"), "browser: filter by name and type from the URL");
			await closeKeys();
			if (!mobile) await shot("browser-filtered");
		}

		/* ---------------- browser: every type ---------------- */

		if (run("types")) {
			const views = [
				["greeting", "string", () => page.getByText("Hello from blaze").first()],
				["cache:product:10", "string-json", () => page.getByRole("tab", { name: "JSON" })],
				["blob:avatar:1", "string-binary", () => page.getByText("00000000").first()],
				["queue:emails", "list", () => page.locator('[data-cell="0:1"]')],
				["user:1", "hash", () => page.getByRole("gridcell", { name: "email" })],
				["tags:all", "set", () => page.locator('[data-cell="0:0"]')],
				["leaderboard:weekly", "zset", () => page.getByRole("columnheader", { name: /score/ })],
				["events:orders", "stream", () => page.getByRole("columnheader", { name: /order_id/ })],
				["config:app", "json", () => page.getByRole("tree", { name: "JSON document" })],
				["ts:cpu:web-1", "module", () => page.getByText("values open in the console")],
			];
			for (const [key, name, locate] of views) {
				await openKey(key);
				const visible = await locate()
					.first()
					.isVisible()
					.catch(() => false);
				check(visible, `browser: ${name} viewer (${key})`);
				if (!mobile || ["hash", "stream", "json", "string-binary"].includes(name)) await shot(`type-${name}`);
				if (name === "stream") {
					await page.getByRole("tab", { name: /Consumer groups/ }).click();
					await page.waitForTimeout(300);
					check(await page.getByRole("cell", { name: "fulfillment" }).isVisible(), "browser: stream consumer groups");
					if (!mobile) await shot("type-stream-groups");
				}
			}
			if (mobile) {
				await page.goto(browserUrl, { waitUntil: "networkidle" });
				await openKeys();
				await page.waitForTimeout(800);
				await shot("browser-keys-sheet");
				await closeKeys();
			}
		}

		/* ---------------- console ---------------- */

		if (run("console")) {
			await freshConsole();
			await shot("console-empty");
			await page.keyboard.type("zrevr");
			await page.waitForSelector(".cm-tooltip-autocomplete", { timeout: 10_000 }).catch(() => {});
			const popup = await page.locator(".cm-tooltip-autocomplete").innerText().catch(() => "");
			check(popup.toUpperCase().includes("ZREVRANGE"), "console: completes command names");
			await shot("console-complete");
			await page.keyboard.press("Escape");
			await page.keyboard.press("Control+a");
			await page.keyboard.press("Delete");
			await page.keyboard.type("SET k");
			await page.waitForTimeout(300);
			const hint = await page.locator(".cm-redis-hint").innerText().catch(() => "");
			check(hint.includes("value"), `console: argument hint after SET k (${hint.slice(0, 30)})`);
			await page.keyboard.type(" v ");
			await page.keyboard.press("Control+Space");
			await page.waitForTimeout(300);
			const words = await page.locator(".cm-tooltip-autocomplete").innerText().catch(() => "");
			check(words.includes("EX") && words.includes("NX"), "console: completes the words SET allows next");
			await shot("console-hint");
			await page.keyboard.press("Escape");
			await page.keyboard.press("Control+a");
			await page.keyboard.press("Delete");

			await typeLine("SCAN 0 MATCH user:* COUNT 5");
			await page.keyboard.press("Shift+Enter");
			await typeLine("HGETALL user:1");
			await page.keyboard.press("Shift+Enter");
			await typeLine("JSON.GET config:app $.name");
			await page.keyboard.press("Enter");
			await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30_000 });
			await page.waitForTimeout(400);
			check((await page.locator('[role="log"] > ol > li').count()) === 3, "console: one block per line");
			check(await page.getByText('"camila.turing.1@example.com"').first().isVisible().catch(() => false) ||
				(await page.locator('[role="log"]').innerText()).includes("@example.com"), "console: hash reply renders as a map");
			await shot("console-multi");

			await page.keyboard.press("Control+l");
			await typeLine("SUBSCRIBE news");
			await page.keyboard.press("Shift+Enter");
			await typeLine("MONITOR");
			await page.keyboard.press("Shift+Enter");
			await typeLine("BLPOP e2e:empty:queue 0");
			await page.keyboard.press("Enter");
			await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30_000 });
			const transcript = await page.locator('[role="log"]').innerText();
			check(transcript.includes("Not available in the console"), "console: SUBSCRIBE and MONITOR are refused");
			check(/capped at 5s/.test(transcript), "console: BLPOP 0 is capped at 5s");
			await shot("console-blocked");

			await typeLine("DEL e2e:a e2e:b");
			await page.keyboard.press("Enter");
			await page.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });
			check(await page.locator('[role="alertdialog"]').isVisible(), "console: multi-key DEL asks first");
			await shot("console-confirm");
			await page.getByRole("button", { name: "Cancel" }).click();
		}

		/* ---------------- cross links ---------------- */

		if (run("links")) {
			await freshConsole();
			await typeLine("HGETALL user:1");
			await page.keyboard.press("Enter");
			await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30_000 });
			await page.getByRole("button", { name: "Open user:1 in the Browser" }).click();
			await page.waitForURL(/\/browser\?key=user%3A1/, { timeout: 20_000 });
			check(true, "links: key argument in the console opens the Browser");
			await page.getByRole("heading", { name: "user:1" }).waitFor({ timeout: 20_000 });
			await page.getByRole("link", { name: "Open in console" }).click();
			await page.waitForURL(/\/console/, { timeout: 20_000 });
			const filled = await page
				.waitForFunction(() => document.querySelector(".cm-content")?.textContent?.includes("HGETALL user:1"), null, {
					timeout: 10_000,
				})
				.then(() => true)
				.catch(() => false);
			check(filled, "links: Open in console fills the input, unrun");
			await page.keyboard.press("Enter");
			await page.waitForTimeout(400);
			await freshConsole();
			await typeLine("SCAN 0 MATCH leaderboard:* COUNT 10000");
			await page.keyboard.press("Enter");
			await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30_000 });
			await page.locator('[role="log"] button[title="Open in Browser"]').first().click();
			await page.waitForURL(/\/browser\?key=leaderboard/, { timeout: 20_000 });
			check(true, "links: key names in a SCAN reply open the Browser");
		}

		/* ---------------- editing, once ---------------- */

		if (run("edit") && firstPass) {
			const dialog = () => page.getByRole("dialog");
			const create = async (type, name, value) => {
				await page.goto(browserUrl, { waitUntil: "networkidle" });
				if (mobile) await openKeys();
				await page.getByRole("button", { name: "New key" }).click();
				await dialog().getByLabel("Type").click();
				await page.getByRole("option", { name: new RegExp(type) }).click();
				await dialog().getByLabel("Name").fill(name);
				await dialog().locator("textarea").fill(value);
				if (name === "e2e:hash") await shot("edit-new-key");
				await dialog().getByRole("button", { name: "Create key" }).click();
				await page.waitForURL(new RegExp(`key=${encodeURIComponent(name)}`), { timeout: 15_000 });
				await page.getByRole("heading", { name }).waitFor();
				await page.waitForTimeout(400);
			};
			const save = async (label = "Save") => {
				await dialog().getByRole("button", { name: label }).click();
				await dialog().waitFor({ state: "detached", timeout: 10_000 });
				await page.waitForTimeout(700);
			};

			await create("String", "e2e:string", "first");
			await page.getByRole("button", { name: "Edit", exact: true }).click();
			await dialog().locator("textarea").fill("second");
			await save();
			check(await page.getByText("second").first().isVisible(), "edit: string value");

			await create("List", "e2e:list", "a\nb\nc");
			await page.locator('[data-cell="1:1"]').dblclick();
			await dialog().locator("textarea").fill("B");
			await shot("edit-list-element");
			await save();
			check((await page.locator('[data-cell="1:1"]').innerText()).includes("B"), "edit: list element (LSET)");
			await page.locator('[data-cell="0:1"]').dblclick();
			await dialog().getByRole("button", { name: "Remove element" }).click();
			await dialog().waitFor({ state: "detached" });
			await page.waitForTimeout(700);
			check((await page.locator('[data-cell="0:1"]').innerText()).includes("B"), "edit: list element removed");
			await page.getByRole("button", { name: "Add element" }).click();
			await dialog().locator("textarea").fill("tail");
			await save("Add");

			await create("Hash", "e2e:hash", '{"name":"Ada","plan":"free"}');
			await page.locator('[data-cell="1:1"]').dblclick();
			await dialog().getByLabel("Field").fill("tier");
			await dialog().locator("textarea").fill("pro");
			await shot("edit-hash-field");
			await save();
			check(await page.getByRole("gridcell", { name: "tier" }).isVisible(), "edit: hash field renamed and saved");

			await create("^SET Set$", "e2e:set", "red\ngreen");
			await page.getByRole("button", { name: "Add member" }).click();
			await dialog().locator("textarea").fill("blue");
			await save("Add member");
			check(await page.getByRole("gridcell", { name: "blue" }).isVisible(), "edit: set member added");

			await create("Sorted set", "e2e:zset", "10 alpha\n20 beta");
			await page.locator('[data-cell="0:1"]').dblclick();
			await dialog().getByLabel("Score").fill("30");
			await save();
			check(
				(await page.locator('[data-cell="1:1"]').innerText()).includes("alpha"),
				"edit: sorted set score moves the member",
			);

			await create("Stream", "e2e:stream", '{"event":"signup"}');
			await page.getByRole("button", { name: "Add entry" }).click();
			await dialog().locator("textarea").fill('{"event":"login"}');
			await save("Add entry");
			check(await page.getByRole("gridcell", { name: "login" }).isVisible(), "edit: stream entry added");

			await create("JSON", "e2e:json", '{"a":1,"b":{"c":true}}');
			await page.getByRole("button", { name: "Edit $.a" }).click({ force: true });
			await dialog().locator("textarea").fill('"hello"');
			await shot("edit-json-path");
			await save();
			check(await page.getByText('"hello"').first().isVisible(), "edit: JSON value at a path");

			// TTL, rename, delete on the JSON key.
			await page.getByRole("button", { name: "Expiry" }).click();
			await dialog().getByLabel("Expire in").fill("2");
			await shot("edit-ttl");
			await save("Set expiry");
			check(/2h|1h 59m/.test(await page.locator("header").filter({ hasText: "TTL" }).innerText()), "edit: TTL set");
			await page.getByRole("button", { name: "Expiry" }).click();
			await dialog().getByRole("button", { name: "Remove expiry" }).click();
			await dialog().waitFor({ state: "detached" });
			await page.waitForTimeout(700);
			check((await page.locator("header").filter({ hasText: "TTL" }).innerText()).includes("No expiry"), "edit: TTL removed (PERSIST)");
			await page.getByRole("button", { name: "Rename" }).click();
			await dialog().getByLabel("New name").fill("e2e:json:renamed");
			await save("Rename");
			check(page.url().includes("e2e%3Ajson%3Arenamed"), "edit: rename moves the selection");
			await page.getByRole("button", { name: "Delete", exact: true }).click();
			await page.waitForSelector('[role="alertdialog"]');
			await shot("edit-delete-confirm");
			await page.getByRole("alertdialog").getByRole("button", { name: "Delete key" }).click();
			await page.waitForTimeout(1000);
			check(!page.url().includes("key="), "edit: delete after confirmation");

			// Bulk delete by pattern: preview first.
			await page.getByRole("button", { name: "More key actions" }).click();
			await page.getByRole("menuitem", { name: /Delete keys by pattern/ }).click();
			await dialog().getByLabel("Pattern").fill("e2e:*");
			await dialog().getByRole("button", { name: "Preview" }).click();
			await dialog().getByText(/keys? match/).waitFor({ timeout: 10_000 });
			const preview = await dialog().innerText();
			check(/6 keys match/.test(preview), `edit: bulk delete previews the count (${preview.match(/\d+ keys? match/)?.[0]})`);
			await shot("edit-bulk-preview");
			await dialog().getByRole("button", { name: /^Delete 6 keys/ }).click();
			await dialog().getByText(/Deleted 6 keys/).waitFor({ timeout: 20_000 });
			check(true, "edit: bulk delete removes exactly the previewed keys");
			await dialog().getByRole("button", { name: "Close" }).first().click();
		}

		/* ---------------- full database, once ---------------- */

		if (run("oom") && firstPass) {
			const redis = localRedis();
			await redis.connect();
			// Fill in shrinking chunks until each size is refused, so the database ends up at
			// its limit rather than a megabyte under it.
			let filled = 0;
			let n = 0;
			for (const size of [1024 * 1024, 64 * 1024, 4 * 1024]) {
				const blob = "x".repeat(size);
				try {
					for (let i = 0; i < 200; i++) {
						await redis.set(`fill:${n++}`, blob);
						filled += size;
					}
				} catch {}
			}
			log(`   filled ${(filled / 1024 / 1024).toFixed(1)} MB until Redis refused`);
			redis.disconnect();

			await freshConsole();
			// SETRANGE at a 4 MB offset allocates 4 MB from a one-line command. Redis checks the
			// limit before each write and frees buffer memory between them, so the first may
			// still fit; three in a row cannot.
			for (const i of [1, 2, 3]) {
				await typeLine(`SETRANGE e2e:oom:${i} 4000000 x`);
				if (i < 3) await page.keyboard.press("Shift+Enter");
			}
			await page.keyboard.press("Enter");
			await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30_000 });
			check(
				(await page.locator('[role="log"]').innerText()).includes("Database is full: 64 MB limit"),
				"oom: console explains the full database",
			);
			await shot("oom-console");

			await page.goto(browserUrl, { waitUntil: "networkidle" });
			await page.waitForTimeout(800);
			await page.getByRole("button", { name: "New key" }).click();
			await page.getByRole("dialog").getByLabel("Name").fill("e2e:oom");
			await page.getByRole("dialog").locator("textarea").fill("x".repeat(64 * 1024));
			await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();
			await page.getByRole("dialog").getByText(/Database is full/).waitFor({ timeout: 10_000 });
			check(true, "oom: browser shows the full database in the dialog");
			await shot("oom-browser");
			await page.keyboard.press("Escape");
			await cleanup();
		}

		/* ---------------- Ask AI, once per width ---------------- */

		if (run("ai") && (firstPass || mobile)) {
			await freshConsole();
			await typeLine("HGETALL user:1 extra");
			await page.keyboard.press("Enter");
			await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30_000 });
			await page.getByRole("button", { name: "Fix with AI" }).click();
			await page.getByText("Fixing").waitFor({ timeout: 10_000 });
			await page.getByRole("button", { name: "Replace input" }).waitFor({ timeout: 20_000 });
			await shot("ai-fix");
			await page.getByRole("button", { name: "Replace input" }).click();
			await page.waitForTimeout(400);
			check((await input.innerText()).trim() === "HGETALL user:1", "ai: fix replaces the input and runs nothing");
			check(
				(await page.locator('[role="log"] > ol > li').count()) === 1,
				"ai: the suggestion was not executed",
			);
			if (!mobile) {
				await page.getByRole("tab", { name: "Write commands" }).click();
				await page.locator("#assistant-prompt").fill("Top 10 weekly players");
				await page.getByRole("button", { name: "Write commands" }).last().click();
				await page.getByRole("button", { name: "Insert" }).waitFor({ timeout: 20_000 });
				await shot("ai-write");
			}
		}

		firstPass = false;
		await context.close();
	}
}

await browser.close();
await cleanup();
if (failures.length) {
	console.log(`\n${failures.length} failure(s):`);
	for (const f of failures) console.log(" -", f);
	process.exit(1);
}
console.log("\nall checks passed");

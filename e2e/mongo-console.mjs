/**
 * Drives the Mongo Browser and Shell end to end against the local MongoDB from
 * docker-compose.dev.yaml (see README → "Local MongoDB").
 *
 *   node --env-file=.env.local e2e/mongo-console.mjs --out <dir>
 *        [--modes dark,light] [--widths 1440,390] [--only flow,flow]
 *
 * Signs in the dedicated test user with a Clerk testing token, then covers: the
 * collection list, find with a filter, projection and sort, paging, the table and JSON
 * views, the shell (every method family, completion, parse errors, refused commands, the
 * confirmations), cross-links between the two, the overview and docs pages, and, once
 * (the first mode and width): creating a collection, inserting, editing and deleting a
 * document, creating and dropping an index, dropping the collection, and Ask AI against
 * e2e/mock-openai.ts.
 *
 * Writes only `e2e_*` collections and drops them again, connecting to 127.0.0.1 only.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { chromium } from "@playwright/test";
import { MongoClient } from "mongodb";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};
const out = flag("out", "e2e/screens-mongo");
const base = flag("base", "http://localhost:3000");
const modes = flag("modes", "dark,light").split(",");
const widths = flag("widths", "1440,390").split(",").map(Number);
const only = flag("only", "")?.split(",").filter(Boolean);
const email = process.env.E2E_EMAIL ?? "blaze-ui-test+clerk_test@example.com";
const DB = "db_appdevmngo2";
const browserUrl = `${base}/databases/${DB}/browser`;
const shellUrl = `${base}/databases/${DB}/console`;

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

/** The local Mongo, as the tenant. Only ever 127.0.0.1. */
async function cleanup() {
	const client = new MongoClient(
		"mongodb://u_app_dev:devpassword-app@127.0.0.1:27018/db_app_dev?tls=true&tlsAllowInvalidCertificates=true&authSource=db_app_dev&directConnection=true",
		{ serverSelectionTimeoutMS: 5_000 },
	);
	await client.connect();
	const db = client.db("db_app_dev");
	for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
		if (name.startsWith("e2e_")) await db.collection(name).drop();
	}
	await client.close();
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
		log(`mongo · ${tag}`);

		const openList = async () => {
			if (mobile) {
				await page.getByRole("button", { name: /^Collections/ }).click();
				await page.waitForTimeout(400);
			}
		};
		const openCollection = async (name, extra = "") => {
			await page.goto(`${browserUrl}?c=${encodeURIComponent(name)}${extra}`, {
				waitUntil: "networkidle",
				timeout: 90_000,
			});
			await page.getByRole("heading", { name, exact: true }).waitFor({ timeout: 20_000 });
			await page.waitForTimeout(600);
		};
		const shellInput = page.getByRole("textbox", { name: /Mongo shell input/ });
		const idle = () =>
			page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 40_000 });
		const freshShell = async () => {
			await page.goto(shellUrl, { waitUntil: "networkidle", timeout: 90_000 });
			await page.evaluate((key) => localStorage.removeItem(key), `blaze.mongo.tabs.${DB}`);
			await page.reload({ waitUntil: "networkidle" });
			await shellInput.click();
			await page.keyboard.press("Control+l");
		};
		const typeCommand = async (text) => {
			await shellInput.click();
			await page.keyboard.press("Control+a");
			await page.keyboard.press("Delete");
			await page.keyboard.insertText(text);
			await page.keyboard.press("Escape");
		};
		const runCommand = async (text) => {
			await typeCommand(text);
			await page.keyboard.press("Enter");
			await idle();
			await page.waitForTimeout(250);
			return page.locator('[role="log"] > ol > li').last().innerText();
		};

		/* ---------------- browser: list, find, views, paging ---------------- */

		if (run("browse")) {
			await page.goto(browserUrl, { waitUntil: "networkidle", timeout: 90_000 });
			await page.getByText("Storage").first().waitFor();
			await openList();
			const list = page.getByRole("navigation", { name: /Collections in/ });
			await list.getByRole("button", { name: /orders/ }).waitFor({ timeout: 20_000 });
			check((await list.innerText()).includes("2,000 docs"), "browser: collections list shows counts");
			if (mobile) await shot("browser-list-sheet");
			else await shot("browser-empty");
			await list.getByRole("button", { name: /orders/ }).click();
			await page.getByRole("heading", { name: "orders", exact: true }).waitFor();
			await page.waitForTimeout(800);
			check(
				(await page.getByRole("columnheader", { name: /status/ }).count()) > 0,
				"browser: documents render as a table with top-level fields",
			);
			check(
				(await page.locator("body").innerText()).includes("1–50 of 2,000"),
				"browser: page range and count",
			);
			await shot("browser-table");

			await page.getByRole("button", { name: "Next page" }).click();
			await page.waitForTimeout(900);
			check((await page.locator("body").innerText()).includes("51–100"), "browser: next page (skip)");
			await page.getByRole("button", { name: "Previous page" }).click();
			await page.waitForTimeout(900);

			// Filter, projection and sort.
			const filter = page.getByRole("textbox", { name: "Filter", exact: true });
			await filter.click();
			await page.keyboard.insertText("{ status: 'shipped', total: { $gt: 1000 } }");
			await page.getByRole("button", { name: "Projection, sort and limit" }).click();
			await page.getByRole("textbox", { name: "Project", exact: true }).click();
			await page.keyboard.insertText("{ number: 1, status: 1, total: 1 }");
			await page.getByRole("textbox", { name: "Sort", exact: true }).click();
			await page.keyboard.insertText("{ total: -1 }");
			await page.getByRole("button", { name: "Find", exact: true }).click();
			await page.waitForTimeout(1500);
			const grid = await page.locator('[role="grid"]').innerText();
			check(
				grid.includes("shipped") && !grid.includes("paid") && !grid.includes("currency"),
				"browser: filter and projection apply",
			);
			await shot("browser-filtered");

			await page.getByRole("tab", { name: "JSON" }).click();
			await page.waitForTimeout(600);
			check((await page.getByRole("tree").count()) > 0, "browser: JSON view renders document trees");
			await shot("browser-json");
			await page.getByRole("tab", { name: "Table" }).click();

			// A bad filter is caught before it is sent.
			await filter.click();
			await page.keyboard.press("Control+a");
			await page.keyboard.insertText("{ status: shipped }");
			await page.getByRole("button", { name: "Find", exact: true }).click();
			await page.waitForTimeout(500);
			check(
				(await page.getByRole("alert").first().innerText()).includes("Strings need quotes"),
				"browser: an invalid filter explains itself",
			);
			if (!mobile) await shot("browser-filter-error");

			// Inspector.
			await page.getByRole("button", { name: "Reset query" }).click();
			await page.waitForTimeout(1200);
			await page.locator('[data-cell="0:1"]').dblclick();
			await page.getByRole("dialog").waitFor({ timeout: 10_000 });
			check(
				(await page.getByRole("dialog").innerText()).includes("ObjectId("),
				"browser: opening a row shows the document tree",
			);
			await shot("browser-inspector");
			await page.keyboard.press("Escape");

			await openCollection("orders", "&tab=indexes");
			check(
				(await page.locator("table").innerText()).includes("status_placedAt"),
				"browser: indexes tab lists indexes",
			);
			await shot("browser-indexes");
		}

		/* ---------------- browser: editing, once ---------------- */

		if (run("edit") && firstPass) {
			const dialog = () => page.getByRole("dialog");
			await page.goto(browserUrl, { waitUntil: "networkidle" });
			await page.getByRole("button", { name: "New collection" }).click();
			await dialog().getByLabel("Name").fill("e2e_docs");
			await shot("edit-new-collection");
			await dialog().getByRole("button", { name: "Create collection" }).click();
			await page.waitForURL(/c=e2e_docs/, { timeout: 15_000 });
			await page.getByRole("heading", { name: "e2e_docs", exact: true }).waitFor();
			check(true, "edit: create collection");

			await page.getByRole("button", { name: "Insert", exact: true }).click();
			const editor = dialog().getByRole("textbox", { name: /Document/ });
			await editor.click();
			await page.keyboard.press("Control+a");
			await page.keyboard.insertText(
				"{ name: 'Ada', joined: ISODate('2026-02-03T04:05:06Z'), visits: NumberLong('7'), tags: ['a', 'b'] }",
			);
			await shot("edit-insert");
			await dialog().getByRole("button", { name: /^Insert/ }).click();
			await dialog().waitFor({ state: "detached", timeout: 10_000 });
			await page.waitForTimeout(1200);
			check((await page.locator('[role="grid"]').innerText()).includes("Ada"), "edit: insert a document");

			await page.getByRole("tab", { name: "JSON" }).click();
			await page.waitForTimeout(500);
			await page.getByRole("button", { name: "Edit document" }).first().click();
			const doc = await dialog().getByRole("textbox", { name: /Document/ }).innerText();
			check(
				doc.includes('NumberLong("7")') && doc.includes("ISODate("),
				"edit: the editor keeps BSON types (NumberLong, ISODate)",
			);
			await dialog().getByRole("textbox", { name: /Document/ }).click();
			await page.keyboard.press("Control+a");
			await page.keyboard.insertText(doc.replace("'Ada'", "'Grace'").replace('"Ada"', '"Grace"'));
			await shot("edit-document");
			await dialog().getByRole("button", { name: /^Save/ }).click();
			await dialog().waitFor({ state: "detached", timeout: 10_000 });
			await page.waitForTimeout(800);
			check(
				(await page.getByRole("tree").first().innerText()).includes("Grace"),
				"edit: save replaces the document",
			);

			// _id cannot change.
			await page.getByRole("button", { name: "Edit document" }).first().click();
			await dialog().getByRole("textbox", { name: /Document/ }).click();
			await page.keyboard.press("Control+a");
			await page.keyboard.insertText("{ _id: 1, name: 'x' }");
			await dialog().getByRole("button", { name: /^Save/ }).click();
			await dialog().getByText(/_id cannot be changed/).waitFor({ timeout: 10_000 });
			check(true, "edit: changing _id is refused");
			await page.keyboard.press("Escape");
			await page.waitForTimeout(400);

			await page.getByRole("button", { name: "Delete document" }).first().click();
			await page.waitForSelector('[role="alertdialog"]');
			await shot("edit-delete-confirm");
			await page.getByRole("alertdialog").getByRole("button", { name: "Delete document" }).click();
			await page.waitForTimeout(1200);
			check(
				(await page.locator("body").innerText()).includes("This collection is empty"),
				"edit: delete after confirmation",
			);

			// Indexes.
			await page.getByRole("tab", { name: "Indexes" }).click();
			await page.getByRole("button", { name: "Create index" }).click();
			await dialog().getByRole("textbox", { name: "Index keys" }).click();
			await page.keyboard.press("Control+a");
			await page.keyboard.insertText("{ name: 1 }");
			await dialog().getByText("Unique").click();
			await shot("edit-create-index");
			await dialog().getByRole("button", { name: "Create index" }).click();
			await dialog().waitFor({ state: "detached", timeout: 10_000 });
			await page.waitForTimeout(800);
			check((await page.locator("table").innerText()).includes("name_1"), "edit: create a unique index");
			await page.getByRole("button", { name: "Drop index name_1" }).click();
			await page.getByRole("alertdialog").getByRole("button", { name: "Drop index" }).click();
			await page.waitForTimeout(1000);
			check(!(await page.locator("table").innerText()).includes("name_1"), "edit: drop an index after confirmation");

			// Drop the collection: the button waits for the typed name.
			await page.getByRole("button", { name: "Collection actions" }).click();
			await page.getByRole("menuitem", { name: /Drop collection/ }).click();
			const confirm = page.getByRole("alertdialog");
			check(
				await confirm.getByRole("button", { name: "Drop collection" }).isDisabled(),
				"edit: drop collection is disabled until the name is typed",
			);
			await confirm.getByRole("textbox").fill("e2e_docs");
			await shot("edit-drop-collection");
			await confirm.getByRole("button", { name: "Drop collection" }).click();
			await page.waitForTimeout(1200);
			check(!page.url().includes("c=e2e_docs"), "edit: drop collection after typing its name");
		}

		/* ---------------- shell ---------------- */

		if (run("shell")) {
			await freshShell();
			await shot("shell-empty");
			await shellInput.click();
			await page.keyboard.type("db.or");
			await page.waitForTimeout(300);
			await page.keyboard.press("Control+Space");
			await page.waitForSelector(".cm-tooltip-autocomplete", { timeout: 10_000 }).catch(() => {});
			check(
				(await page.locator(".cm-tooltip-autocomplete").innerText().catch(() => "")).includes("orders"),
				"shell: completes collection names",
			);
			await page.keyboard.press("Tab");
			await page.keyboard.type(".fi");
			await page.keyboard.press("Control+Space");
			await page.waitForTimeout(300);
			check(
				(await page.locator(".cm-tooltip-autocomplete").innerText().catch(() => "")).includes("findOne"),
				"shell: completes collection methods",
			);
			await page.keyboard.press("Escape");
			await page.keyboard.type("nd({ total: { $g");
			await page.keyboard.press("Control+Space");
			await page.waitForTimeout(300);
			check(
				(await page.locator(".cm-tooltip-autocomplete").innerText().catch(() => "")).includes("$gte"),
				"shell: completes query operators",
			);
			await shot("shell-complete");
			await page.keyboard.press("Escape");

			const families = [
				["show collections", /orders/],
				["db.getCollectionNames()", /products/],
				["db.orders.find({ status: 'paid' }).sort({ placedAt: -1 }).limit(3)", /3 documents/],
				["db.orders.findOne({}, { number: 1 })", /number/],
				["db.orders.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }, { $sort: { n: -1 } }])", /5 documents/],
				["db.orders.countDocuments({ status: 'refunded' })", /^\d|\n\d/],
				["db.orders.estimatedDocumentCount()", /2,000/],
				["db.orders.distinct('status')", /delivered/],
				["db.e2e_shell.insertOne({ n: 1, at: ISODate('2026-01-01') })", /insertedId/],
				["db.e2e_shell.insertMany([{ n: 2 }, { n: 3 }])", /insertedCount/],
				["db.e2e_shell.updateOne({ n: 1 }, { $set: { done: true } })", /modifiedCount/],
				["db.e2e_shell.updateMany({ n: { $gt: 1 } }, { $inc: { n: 10 } })", /modifiedCount/],
				["db.e2e_shell.replaceOne({ n: 12 }, { n: 12, replaced: true })", /matchedCount/],
				["db.e2e_shell.deleteOne({ n: 13 })", /deletedCount/],
				["db.e2e_shell.createIndex({ n: 1 })", /n_1/],
				["db.e2e_shell.getIndexes()", /2 documents/],
				["db.stats()", /collections/],
				["{ ping: 1 }", /ok/],
			];
			for (const [command, expected] of families) {
				const text = await runCommand(command);
				check(expected.test(text) && !/Command failed|Could not read/.test(text), `shell: ${command.slice(0, 60)}`);
				if (command.startsWith("db.orders.aggregate")) await shot("shell-aggregate");
				if (command.startsWith("db.orders.find(")) await shot("shell-find");
			}

			const parse = await runCommand("db.orders.find({ status: paid })");
			check(parse.includes("Could not read this command") && parse.includes("^"), "shell: parse error with a pointer");
			await shot("shell-parse-error");
			const js = await runCommand("var x = db.orders.find()");
			check(js.includes("does not run JavaScript"), "shell: JavaScript is refused");
			const watch = await runCommand("db.orders.watch()");
			check(watch.includes("Not available in the shell"), "shell: watch() is blocked");
			const tail = await runCommand("db.orders.find().tailable()");
			check(tail.includes("Not available in the shell"), "shell: tailable cursors are blocked");
			const getMore = await runCommand("{ getMore: 1, collection: 'orders' }");
			check(getMore.includes("Not available in the shell"), "shell: getMore is blocked");
			await shot("shell-blocked");

			// Confirmations.
			await typeCommand("db.e2e_shell.deleteMany({})");
			await page.keyboard.press("Enter");
			await page.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });
			check(
				(await page.getByRole("alertdialog").innerText()).includes("every document in e2e_shell"),
				"shell: deleteMany({}) asks first",
			);
			await shot("shell-confirm");
			await page.getByRole("button", { name: "Cancel" }).click();
			await typeCommand("db.e2e_shell.updateMany({}, { $set: { x: 1 } })");
			await page.keyboard.press("Enter");
			await page.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });
			check(true, "shell: updateMany({}) asks first");
			await page.getByRole("button", { name: "Cancel" }).click();
			await typeCommand("db.dropDatabase()");
			await page.keyboard.press("Enter");
			await page.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });
			const drop = page.getByRole("alertdialog");
			check(
				await drop.getByRole("button", { name: "Drop database" }).isDisabled(),
				"shell: dropDatabase needs the database name typed",
			);
			await shot("shell-drop-database");
			await drop.getByRole("button", { name: "Cancel" }).click();

			await typeCommand("db.e2e_shell.drop()");
			await page.keyboard.press("Enter");
			await page.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });
			await page.getByRole("alertdialog").getByRole("button", { name: "Run anyway" }).click();
			await idle();
			await page.waitForTimeout(300);
			check(
				(await page.locator('[role="log"] > ol > li').last().innerText()).includes("true"),
				"shell: drop() runs after confirmation",
			);

			// History with the arrow key.
			await shellInput.click();
			await page.keyboard.press("ArrowUp");
			await page.waitForTimeout(200);
			check((await shellInput.innerText()).includes("db.e2e_shell.drop()"), "shell: ↑ recalls history");
			await page.keyboard.press("Escape");
		}

		/* ---------------- cross links ---------------- */

		if (run("links")) {
			await freshShell();
			await runCommand("db.products.find().limit(2)");
			const before = await page.locator('[role="log"] > ol > li').count();
			await page.getByRole("link", { name: "Open products in the Browser" }).click({ force: true });
			await page.waitForURL(/\/browser\?c=products/, { timeout: 20_000 });
			await page.getByRole("heading", { name: "products", exact: true }).waitFor({ timeout: 20_000 });
			check(true, "links: a shell command opens its collection in the Browser");
			await page.getByRole("link", { name: "Open in shell" }).click();
			await page.waitForURL(/\/console/, { timeout: 20_000 });
			const filled = await page
				.waitForFunction(
					() => document.querySelector('[aria-label^="Mongo shell input"]')?.textContent?.includes("db.products.find({})"),
					null,
					{ timeout: 10_000 },
				)
				.then(() => true)
				.catch(() => false);
			check(filled, "links: Open in shell fills the input, unrun");
			check(
				(await page.locator('[role="log"] > ol > li').count()) <= before,
				"links: nothing ran",
			);
		}

		/* ---------------- overview, docs ---------------- */

		if (run("pages")) {
			await page.goto(`${base}/databases/${DB}`, { waitUntil: "networkidle", timeout: 90_000 });
			const text = await page.locator("main").innerText();
			check(text.includes("tlsAllowInvalidCertificates") && text.includes("Shell"), "overview: Mongo connection notes and tools");
			check(text.includes("defaultMaxTimeMS"), "overview: Mongo limits");
			await shot("overview");
			for (const path of ["/databases/" + DB + "/sql", "/databases/" + DB + "/tables"]) {
				await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
				// The dashboard streams (loading.tsx), so the 404 arrives as the not-found page
				// inside a 200 response; the page, not the status, is what to check.
				check(
					(await page.locator("body").innerText()).includes("Nothing at this address"),
					`pages: ${path.split("/").pop()} 404s for Mongo`,
				);
			}
			await page.goto(`${base}/docs/mongodb`, { waitUntil: "networkidle", timeout: 90_000 });
			check((await page.locator("body").innerText()).includes("tlsAllowInvalidCertificates"), "docs: MongoDB page");
			await shot("docs-mongodb");
			await page.goto(base, { waitUntil: "networkidle", timeout: 90_000 });
			const engines = await page.locator("body").innerText();
			check(/MongoDB(?!\s*soon)/.test(engines), "landing: MongoDB is offered");
			if (!mobile) await shot("landing");
		}

		/* ---------------- Ask AI ---------------- */

		if (run("ai") && (firstPass || mobile)) {
			await freshShell();
			await runCommand("db.orders.find({ status: paid })");
			await page.getByRole("button", { name: "Fix with AI" }).click();
			await page.getByText("Fixing").waitFor({ timeout: 10_000 });
			await page.getByRole("button", { name: "Replace input" }).waitFor({ timeout: 30_000 });
			await shot("ai-fix");
			await page.getByRole("button", { name: "Replace input" }).click();
			await page.waitForTimeout(400);
			check(
				(await shellInput.innerText()).trim() === "db.orders.find({ status: 'paid' })",
				"ai: fix replaces the input",
			);
			check((await page.locator('[role="log"] > ol > li').count()) === 1, "ai: the suggestion was not executed");
			if (!mobile) {
				await page.getByRole("tab", { name: "Explain command" }).click();
				await page.getByRole("tab", { name: "Write a command" }).click();
				await page.locator("#assistant-prompt").fill("Paid orders over 500, newest first");
				await page.getByRole("button", { name: "Write a command" }).last().click();
				await page.getByRole("button", { name: "Insert", exact: true }).waitFor({ timeout: 30_000 });
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

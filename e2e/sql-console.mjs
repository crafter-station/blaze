/**
 * Drives the SQL console end to end against the local engines from
 * docker-compose.dev.yaml (see README → "Local SQL engines").
 *
 *   node --env-file=.env.local e2e/sql-console.mjs --out <dir> [--engines postgres,mysql]
 *        [--modes dark,light] [--widths 1440,390] [--only flow,flow]
 *
 * Signs in the dedicated test user with a Clerk testing token (no password involved),
 * then for each engine: autocomplete, a multi-statement run, an engine error with its
 * marker, the destructive-statement confirmation (always cancelled), grid selection,
 * the row inspector, the schema explorer and EXPLAIN. Writes only through statements it
 * cancels, so the seed data is left as it was.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};
const out = flag("out", "e2e/screens-sql");
const base = flag("base", "http://localhost:3000");
const modes = flag("modes", "dark").split(",");
const widths = flag("widths", "1440").split(",").map(Number);
const engines = flag("engines", "postgres,mysql,mariadb,libsql").split(",");
const only = flag("only", "")?.split(",").filter(Boolean);
const email = process.env.E2E_EMAIL ?? "blaze-ui-test+clerk_test@example.com";

const DATABASES = {
	postgres: "db_shopdevpgsq2",
	mysql: "db_shopdevmysq2",
	mariadb: "db_shopdevmria2",
	libsql: "db_shopdevsqit2",
};

const TABLE_REF = {
	postgres: "orders",
	mysql: "orders",
	mariadb: "orders",
	libsql: "orders",
};

mkdirSync(out, { recursive: true });
process.env.CLERK_PUBLISHABLE_KEY ??= process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
await clerkSetup();

const failures = [];
const log = (...m) => console.log(...m);

async function setDoc(page, text) {
	const content = page.locator(".cm-content").first();
	await content.click();
	await page.keyboard.press("Control+a");
	await page.keyboard.press("Delete");
	await page.keyboard.insertText(text);
}

async function waitIdle(page) {
	await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 45_000 });
	await page.waitForTimeout(250);
}

async function shot(page, name, mode, width) {
	// Menus and dialogs animate in; capture them settled.
	await page.waitForTimeout(350);
	const file = join(out, `${name}.${mode}.${width}.png`);
	await page.screenshot({ path: file });
	log("  ", file);
}

function check(condition, message) {
	if (!condition) {
		failures.push(message);
		log("   FAIL", message);
	} else log("   ok  ", message);
}

const browser = await chromium.launch();
for (const mode of modes) {
	for (const width of widths) {
		const mobile = width < 600;
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
		await page.goto(`${base}/sign-in`);
		await clerk.signIn({ page, emailAddress: email });

		for (const engine of engines) {
			const id = DATABASES[engine];
			const tag = `${engine}`;
			log(`${engine} · ${mode} · ${width}`);
			await page.goto(`${base}/databases/${id}/sql`, { waitUntil: "networkidle", timeout: 90_000 });
			// Start every run from a clean single tab.
			await page.evaluate((key) => localStorage.removeItem(key), `blaze.sql.tabs.${id}`);
			await page.reload({ waitUntil: "networkidle" });
			await page.evaluate(() => document.fonts.ready);
			await page.waitForSelector(".cm-content");

			const run = (flow) => !only?.length || only.includes(flow);

			if (run("autocomplete") && !mobile) {
				if (!mobile) await page.waitForSelector("text=customers", { timeout: 20_000 });
				await setDoc(page, `select o.id, o.st`);
				await page.waitForSelector(".cm-tooltip-autocomplete", { timeout: 10_000 }).catch(() => {});
				const popup = await page.locator(".cm-tooltip-autocomplete").count();
				check(popup > 0, `${tag}: autocomplete popup after alias column prefix`);
				await setDoc(page, `select * from ${TABLE_REF[engine].slice(0, 3)}`);
				await page.waitForSelector(".cm-tooltip-autocomplete", { timeout: 10_000 }).catch(() => {});
				check((await page.locator(".cm-tooltip-autocomplete li", { hasText: "orders" }).count()) > 0, `${tag}: table completion lists orders`);
				await shot(page, `${tag}-autocomplete`, mode, width);
				await page.keyboard.press("Escape");
			}

			if (run("multi")) {
				await setDoc(
					page,
					`select id, email, full_name, country, created_at from customers order by id limit 120;\nselect status, count(*) as orders, sum(total) as revenue from orders group by status order by 2 desc;\nselect p.name, p.attributes, p.price from products p order by p.id limit 25;`,
				);
				await page.keyboard.press("Shift+Control+Enter");
				await waitIdle(page);
				const tabs = await page.locator('[aria-label="Results"] [role="tab"]').count();
				check(tabs === 3, `${tag}: three result tabs for three statements (got ${tabs})`);
				const cells = await page.locator('[role="gridcell"]').count();
				check(cells > 0, `${tag}: grid renders cells`);
				await shot(page, `${tag}-multi`, mode, width);

				// Grid: select a block, open the row inspector.
				await page.locator('[aria-label="Results"] [role="tab"]').first().click();
				await page.waitForTimeout(200);
				const first = page.locator('[data-cell="0:1"]');
				if (await first.count()) {
					await first.click();
					await page.locator('[data-cell="3:3"]').click({ modifiers: ["Shift"] });
					await shot(page, `${tag}-grid-selection`, mode, width);
					await page.locator('[data-cell="2:1"]').click({ button: "right" });
					await page.waitForSelector('[data-slot="context-menu-content"]');
					await shot(page, `${tag}-grid-menu`, mode, width);
					await page.keyboard.press("Escape");
					await page.locator('[data-cell="2:2"]').dblclick();
					await page.waitForTimeout(300);
					check(
						(await page.getByText("Row 3", { exact: false }).count()) > 0,
						`${tag}: row inspector opens on double-click`,
					);
					await shot(page, `${tag}-inspector`, mode, width);
					await page.keyboard.press("Escape");
					const close = page.getByRole("button", { name: "Close inspector" });
					if (await close.count()) await close.first().click();
				}
			}

			if (run("error")) {
				await setDoc(page, "select id, status\nfrm orders\nwhere total > 100;");
				await page.keyboard.press("Control+Enter");
				await waitIdle(page);
				check((await page.getByText("Query failed").count()) > 0, `${tag}: error is shown`);
				const marked = await page.locator(".cm-lintRange-error").count();
				check(marked > 0, `${tag}: error marked in the editor`);
				await shot(page, `${tag}-error`, mode, width);
			}

			if (run("confirm")) {
				await setDoc(page, "delete from order_items;");
				await page.keyboard.press("Control+Enter");
				await page.waitForSelector('[role="alertdialog"]', { timeout: 10_000 }).catch(() => {});
				check((await page.locator('[role="alertdialog"]').count()) > 0, `${tag}: destructive statement asks first`);
				await shot(page, `${tag}-confirm`, mode, width);
				await page.getByRole("button", { name: "Cancel" }).click();
			}

			if (run("explorer") && !mobile) {
				await page.getByRole("button", { name: "Expand orders" }).click();
				await page.waitForTimeout(150);
				await page.getByRole("button", { name: "Insert orders" }).click({ button: "right" }).catch(async () => {
					await page.locator('button[title="Insert orders"]').click({ button: "right" });
				});
				await page.waitForSelector('[data-slot="context-menu-content"]', { timeout: 5000 }).catch(() => {});
				await shot(page, `${tag}-explorer`, mode, width);
				await page.keyboard.press("Escape");
			}

			if (run("explain")) {
				await setDoc(
					page,
					"select o.id, c.email, o.total\nfrom orders o\njoin customers c on c.id = o.customer_id\nwhere o.status = 'paid'\norder by o.created_at desc\nlimit 20;",
				);
				await page.keyboard.press("Shift+Control+E");
				await waitIdle(page);
				await page.waitForTimeout(400);
				check((await page.locator("[data-plan-node]").count()) > 0, `${tag}: plan tree renders`);
				await shot(page, `${tag}-explain`, mode, width);
				const analyze = page.getByRole("button", { name: "Run with ANALYZE" });
				if (await analyze.count()) {
					await analyze.click();
					await waitIdle(page);
					await page.waitForTimeout(400);
					check((await page.getByText("Analyzed", { exact: true }).count()) > 0, `${tag}: ANALYZE plan renders`);
					await shot(page, `${tag}-explain-analyze`, mode, width);
				}
			}

			if (run("library")) {
				const name = `e2e ${engine} ${Date.now().toString(36)}`;
				await setDoc(page, "select status, count(*) from orders group by status;");
				await page.keyboard.press("Control+Enter");
				await waitIdle(page);
				await page.keyboard.press("Control+s");
				await page.waitForSelector("#saved-query-name", { timeout: 10_000 });
				await page.fill("#saved-query-name", name);
				await shot(page, `${tag}-save-dialog`, mode, width);
				await page.keyboard.press("Enter");
				await page.waitForSelector("#saved-query-name", { state: "detached", timeout: 10_000 });
				check((await page.getByRole("tab", { name }).count()) > 0, `${tag}: tab renamed after save`);
				{
					// On phones the side panel is a sheet behind the panel button.
					if (mobile) {
						await page.getByRole("button", { name: "Show side panel" }).click();
						await page.waitForTimeout(400);
					}
					await page.getByRole("tab", { name: "Saved" }).click();
					await page.waitForTimeout(200);
					check((await page.getByText(name).count()) > 0, `${tag}: saved query listed`);
					await shot(page, `${tag}-saved`, mode, width);
					await page.getByRole("tab", { name: "History" }).click();
					await page.waitForTimeout(200);
					check((await page.getByText("group by status").count()) > 0, `${tag}: history lists the run`);
					await shot(page, `${tag}-history`, mode, width);
					// Clean up the saved query.
					await page.getByRole("tab", { name: "Saved" }).click();
					await page.getByRole("button", { name: `Actions for ${name}` }).click();
					await page.getByRole("menuitem", { name: "Delete" }).click();
					await page.getByRole("button", { name: "Delete" }).click();
					await page.waitForTimeout(400);
					check((await page.getByText(name, { exact: true }).count()) <= 1, `${tag}: saved query deleted`);
					await page.getByRole("tab", { name: "Schema" }).click();
					if (mobile) await page.keyboard.press("Escape");
				}
				await page.keyboard.press("Control+k");
				await page.waitForSelector('[data-slot="command-input"]', { timeout: 10_000 }).catch(() => {});
				await page.keyboard.type("prev");
				await shot(page, `${tag}-palette`, mode, width);
				await page.keyboard.press("Escape");
				await page.locator("body").click({ position: { x: 5, y: 300 } }).catch(() => {});
				await page.keyboard.press("?");
				await page.waitForTimeout(300);
				check((await page.getByText("Keyboard shortcuts").count()) > 0, `${tag}: shortcuts dialog`);
				await shot(page, `${tag}-shortcuts`, mode, width);
				await page.keyboard.press("Escape");
			}

			if (run("assistant")) {
				await page.getByRole("button", { name: "Ask Claude" }).first().click();
				await page.waitForTimeout(300);
				if ((await page.getByText("The assistant is not set up here").count()) > 0) {
					check(true, `${tag}: assistant explains it is not configured`);
					await shot(page, `${tag}-assistant-disabled`, mode, width);
				} else {
					await page.fill("#assistant-prompt", "Top 10 customers by revenue with their country");
					await page.keyboard.press("Control+Enter");
					await page
						.getByRole("button", { name: "Replace editor" })
						.first()
						.waitFor({ timeout: 30_000 })
						.catch(async (error) => {
							await shot(page, `${tag}-assistant-generate-failed`, mode, width);
							throw error;
						});
					await page.waitForTimeout(300);
					await shot(page, `${tag}-assistant-generate`, mode, width);
					await page.getByRole("button", { name: "Replace editor" }).first().click();
					await page.waitForTimeout(200);
					const doc = await page.locator(".cm-content").first().innerText();
					check(doc.includes("revenue"), `${tag}: assistant SQL replaces the editor (nothing run)`);
					// Fix flow: run a broken statement and hand the error to Claude.
					await setDoc(page, "select id, status\nfrm orders\nwhere total > 100;");
					await page.keyboard.press("Control+Enter");
					await waitIdle(page);
					await page.getByRole("button", { name: "Fix with Claude" }).click();
					await page
						.getByRole("button", { name: "Replace editor" })
						.first()
						.waitFor({ timeout: 30_000 })
						.catch(async (error) => {
							await shot(page, `${tag}-assistant-fix-failed`, mode, width);
							throw error;
						});
					await page.waitForTimeout(300);
					check((await page.getByText("Fixing").count()) > 0, `${tag}: fix request shows the failing SQL`);
					await shot(page, `${tag}-assistant-fix`, mode, width);
				}
				const close = page.getByRole("button", { name: "Close assistant" });
				if (await close.count()) await close.first().click();
			}

			if (run("panel") && mobile) {
				await page.getByRole("button", { name: "Show side panel" }).click();
				await page.waitForTimeout(400);
				await page.getByRole("button", { name: "Expand orders" }).click();
				await shot(page, `${tag}-panel`, mode, width);
				await page.keyboard.press("Escape");
			}

			if (run("overview")) {
				await setDoc(page, "select * from orders order by id limit 200;");
				await page.keyboard.press("Control+Enter");
				await waitIdle(page);
				await shot(page, `${tag}-overview`, mode, width);
			}
		}
		await context.close();
	}
}
await browser.close();

if (failures.length) {
	console.log(`\n${failures.length} failure(s):`);
	for (const f of failures) console.log(" -", f);
	process.exitCode = 1;
} else console.log("\nall checks passed");

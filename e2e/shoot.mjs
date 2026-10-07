/**
 * Screenshot harness for the visual QA pass.
 *
 *   node --env-file=.env.local e2e/shoot.mjs --out <dir> [--auth] [--only name,name]
 *        [--modes dark,light] [--widths 1440,390] /path=name ...
 *
 * Read-only by construction: it navigates and captures, and never clicks anything that
 * mutates state. `--auth` signs in the dedicated test user with a Clerk sign-in token
 * (@clerk/testing), so no password is involved.
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
const out = flag("out", "e2e/screens");
const auth = args.includes("--auth");
const modes = flag("modes", "dark,light").split(",");
const widths = flag("widths", "1440,390").split(",").map(Number);
const base = flag("base", "http://localhost:3000");
const email = process.env.E2E_EMAIL ?? "blaze-ui-test+clerk_test@example.com";
const full = !args.includes("--viewport");
const pages = args
	.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"))
	.map((a) => {
		const [path, name] = a.split("=");
		return { path, name: name ?? (path.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "home") };
	});

mkdirSync(out, { recursive: true });
if (auth) {
	process.env.CLERK_PUBLISHABLE_KEY ??= process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
	await clerkSetup();
}

const browser = await chromium.launch();
for (const mode of modes) {
	for (const width of widths) {
		const context = await browser.newContext({
			viewport: { width, height: width < 600 ? 844 : 900 },
			deviceScaleFactor: width < 600 ? 2 : 1,
			colorScheme: mode,
		});
		const page = await context.newPage();
		// The dev-mode Next indicator is not part of the product; keep it out of captures.
		await context.addInitScript(() => {
			document.addEventListener("DOMContentLoaded", () => {
				const style = document.createElement("style");
				style.textContent = "nextjs-portal{display:none!important}";
				document.head.append(style);
			});
		});
		if (auth) {
			await page.goto(`${base}/sign-in`);
			await clerk.signIn({ page, emailAddress: email });
		}
		for (const { path, name } of pages) {
			await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 90_000 });
			await page.evaluate(() => document.fonts.ready);
			await page.waitForTimeout(Number(flag("wait", "900")));
			const file = join(out, `${name}.${mode}.${width}.png`);
			await page.screenshot({ path: file, fullPage: full });
			console.log(file);
		}
		await context.close();
	}
}
await browser.close();

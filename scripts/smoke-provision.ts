/**
 * End-to-end check of shared-Postgres provisioning against a real instance.
 *
 * The timing is the least interesting part. What this actually verifies is the isolation
 * that shared tenancy makes *our* responsibility rather than Docker's — specifically that
 * one tenant cannot reach another tenant's database on the same instance. That is the
 * single failure that would matter most in a public product, and it is invisible until
 * something explicitly tries it.
 *
 *   ADMIN_URL=postgresql://... bun run scripts/smoke-provision.ts
 */

import { Client } from "pg";
import { generatePassword } from "@/lib/crypto";
import { physicalName } from "@/lib/id";
import {
	deprovisionPostgresDatabase,
	hardenPostgresInstance,
	provisionPostgresDatabase,
	readPostgresStats,
} from "@/lib/provision/postgres";

const ADMIN_URL = process.env.ADMIN_URL;
if (!ADMIN_URL) throw new Error("ADMIN_URL is required");

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
	if (ok) {
		console.log(`  PASS  ${label}${detail ? `  (${detail})` : ""}`);
	} else {
		failures++;
		console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
	}
}

function tenantUrl(dbName: string, role: string, password: string): string {
	const u = new URL(ADMIN_URL as string);
	u.username = role;
	u.password = password;
	u.pathname = `/${dbName}`;
	return u.toString();
}

/** Returns null on success, or the connection error message. */
async function tryConnect(url: string, sql = "select 1"): Promise<string | null> {
	const c = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
	try {
		await c.connect();
		await c.query(sql);
		await c.end();
		return null;
	} catch (e) {
		await c.end().catch(() => {});
		return e instanceof Error ? e.message : String(e);
	}
}

const tenants = ["alpha", "beta"].map((n) => ({
	label: n,
	dbName: physicalName("db", `smoke-${n}`),
	roleName: physicalName("u", `smoke-${n}`),
	password: generatePassword(),
}));

console.log("\nInstance hardening");
await hardenPostgresInstance(ADMIN_URL);
console.log("  applied");

console.log("\nProvisioning");
for (const t of tenants) {
	const started = Date.now();
	await provisionPostgresDatabase({
		adminUrl: ADMIN_URL,
		dbName: t.dbName,
		roleName: t.roleName,
		password: t.password,
	});
	console.log(`  ${t.label}: ${t.dbName}  ${Date.now() - started}ms`);
}

const [alpha, beta] = tenants;

console.log("\nTenant can use its own database");
check(
	"alpha connects to its own database",
	(await tryConnect(tenantUrl(alpha.dbName, alpha.roleName, alpha.password))) === null,
);
check(
	"alpha can create a table",
	(await tryConnect(
		tenantUrl(alpha.dbName, alpha.roleName, alpha.password),
		"create table t (id int); insert into t values (1); drop table t;",
	)) === null,
);

console.log("\nIsolation (these MUST fail)");
const crossTenant = await tryConnect(tenantUrl(beta.dbName, alpha.roleName, alpha.password));
check("alpha CANNOT connect to beta's database", crossTenant !== null, crossTenant ?? "connected!");

const adminDb = await tryConnect(tenantUrl("postgres", alpha.roleName, alpha.password));
check("alpha CANNOT connect to the admin database", adminDb !== null, adminDb ?? "connected!");

console.log("\nPer-tenant limits applied");
{
	const c = new Client({
		connectionString: tenantUrl(alpha.dbName, alpha.roleName, alpha.password),
	});
	await c.connect();
	const timeout = await c.query("show statement_timeout");
	const idle = await c.query("show idle_in_transaction_session_timeout");
	check(
		"statement_timeout is 30s",
		timeout.rows[0].statement_timeout === "30s",
		String(timeout.rows[0].statement_timeout),
	);
	check(
		"idle_in_transaction_session_timeout is 1min",
		idle.rows[0].idle_in_transaction_session_timeout === "1min",
		String(idle.rows[0].idle_in_transaction_session_timeout),
	);
	const limit = await c.query("select rolconnlimit from pg_roles where rolname = $1", [
		alpha.roleName,
	]);
	check(
		"connection limit is 20",
		limit.rows[0].rolconnlimit === 20,
		String(limit.rows[0].rolconnlimit),
	);
	await c.end();
}

console.log("\nStats (feeds quota enforcement and charts)");
{
	const stats = await readPostgresStats(ADMIN_URL, alpha.dbName);
	check("size reported", stats.sizeBytes > 0, `${(stats.sizeBytes / 1024 / 1024).toFixed(1)} MB`);
}

console.log("\nCleanup");
for (const t of tenants) {
	const started = Date.now();
	await deprovisionPostgresDatabase(ADMIN_URL, t.dbName, t.roleName);
	console.log(`  dropped ${t.dbName}  ${Date.now() - started}ms`);
}
check(
	"dropped database is gone",
	(await tryConnect(tenantUrl(alpha.dbName, alpha.roleName, alpha.password))) !== null,
);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

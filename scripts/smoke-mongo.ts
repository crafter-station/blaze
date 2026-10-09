/**
 * The MongoDB half of `smoke-provision.ts`: TLS enforcement, provisioning, isolation, the
 * statement timeout, suspension, password rotation and cleanup, against a real shared
 * instance.
 *
 * Every database and user it creates is named `db_smoke_*` / `u_smoke_*` and dropped at the
 * end, including when a check fails part way: that is what the `finally` is for.
 */

import { MongoClient, MongoServerError } from "mongodb";
import { generatePassword } from "@/lib/crypto";
import { physicalName } from "@/lib/id";
import { LIMITS } from "@/lib/limits";
import {
	deprovisionMongoDatabase,
	hardenMongoInstance,
	provisionMongoDatabase,
	readMongoStats,
	resetMongoPassword,
	resumeMongoDatabase,
	suspendMongoDatabase,
} from "@/lib/provision/mongo";

const TLS = "tls=true&tlsAllowInvalidCertificates=true";

export async function smokeMongo(adminUrl: string): Promise<number> {
	let failures = 0;
	const check = (label: string, ok: boolean, detail = "") => {
		if (!ok) failures++;
		console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
	};

	const tenantUrl = (dbName: string, role: string, password: string, tls = true) => {
		const u = new URL(adminUrl);
		u.username = role;
		u.password = password;
		u.pathname = `/${dbName}`;
		u.search = `?${tls ? `${TLS}&` : ""}authSource=${dbName}&directConnection=true`;
		return u.toString();
	};

	/** Run `fn` on a fresh client. Returns null on success or the first line of the error. */
	const attempt = async (
		url: string,
		fn: (c: MongoClient) => Promise<unknown>,
	): Promise<string | null> => {
		const c = new MongoClient(url, { serverSelectionTimeoutMS: 8_000, connectTimeoutMS: 8_000 });
		try {
			await c.connect();
			await fn(c);
			return null;
		} catch (e) {
			return e instanceof Error ? e.message.split("\n")[0] : String(e);
		} finally {
			await c.close().catch(() => {});
		}
	};

	const tenants = ["alpha", "beta"].map((n) => ({
		label: n,
		dbName: physicalName("db", `smoke-${n}`),
		roleName: physicalName("u", `smoke-${n}`),
		password: generatePassword(),
	}));
	const [alpha, beta] = tenants;
	const alphaUrl = () => tenantUrl(alpha.dbName, alpha.roleName, alpha.password);

	try {
		console.log("\nTLS");
		{
			const plain = new URL(adminUrl);
			plain.search = "?authSource=admin&directConnection=true";
			const err = await attempt(plain.toString(), (c) => c.db("admin").command({ ping: 1 }));
			check("plaintext connection is refused", err !== null, err ?? "connected!");
			const ok = await attempt(adminUrl, (c) => c.db("admin").command({ ping: 1 }));
			check("TLS connection works", ok === null, ok ?? "");
		}

		console.log("\nInstance hardening");
		await hardenMongoInstance(adminUrl);
		{
			const c = new MongoClient(adminUrl);
			await c.connect();
			const res = await c.db("admin").command({ getClusterParameter: "defaultMaxTimeMS" });
			await c.close();
			const value = Number(res.clusterParameters?.[0]?.readOperations);
			check(
				`defaultMaxTimeMS.readOperations is ${LIMITS.STATEMENT_TIMEOUT_MS}`,
				value === LIMITS.STATEMENT_TIMEOUT_MS,
				String(value),
			);
		}

		console.log("\nProvisioning");
		for (const t of tenants) {
			const started = Date.now();
			await provisionMongoDatabase({ adminUrl, ...t });
			console.log(`  ${t.label}: ${t.dbName}  ${Date.now() - started}ms`);
		}

		console.log("\nTenant can use its own database");
		check(
			"alpha writes and reads its own database",
			(await attempt(alphaUrl(), async (c) => {
				await c.db(alpha.dbName).collection("t").insertOne({ x: 1 });
				const doc = await c.db(alpha.dbName).collection("t").findOne({ x: 1 });
				if (!doc) throw new Error("document not found");
			})) === null,
		);
		const tenantPlain = await attempt(
			tenantUrl(alpha.dbName, alpha.roleName, alpha.password, false),
			(c) => c.db(alpha.dbName).command({ ping: 1 }),
		);
		check("alpha plaintext connection is refused", tenantPlain !== null, tenantPlain ?? "");

		console.log("\nIsolation (these MUST fail)");
		await attempt(tenantUrl(beta.dbName, beta.roleName, beta.password), (c) =>
			c.db(beta.dbName).collection("secret").insertOne({ s: "beta" }),
		);
		const crossRead = await attempt(alphaUrl(), (c) =>
			c.db(beta.dbName).collection("secret").findOne({}),
		);
		check("alpha CANNOT read beta's database", crossRead !== null, crossRead ?? "read it!");
		const crossWrite = await attempt(alphaUrl(), (c) =>
			c.db(beta.dbName).collection("secret").insertOne({ s: "alpha" }),
		);
		check("alpha CANNOT write beta's database", crossWrite !== null, crossWrite ?? "wrote it!");
		const crossDrop = await attempt(alphaUrl(), (c) => c.db(beta.dbName).dropDatabase());
		check("alpha CANNOT drop beta's database", crossDrop !== null, crossDrop ?? "dropped it!");
		const adminRead = await attempt(alphaUrl(), (c) =>
			c.db("admin").collection("system.users").findOne({}),
		);
		check("alpha CANNOT read admin", adminRead !== null, adminRead ?? "read it!");
		const crossAuth = await attempt(tenantUrl(beta.dbName, alpha.roleName, alpha.password), (c) =>
			c.db(beta.dbName).command({ ping: 1 }),
		);
		check("alpha CANNOT authenticate against beta", crossAuth !== null, crossAuth ?? "authed!");
		{
			let names: string[] = [];
			await attempt(alphaUrl(), async (c) => {
				const r = await c
					.db("admin")
					.command({ listDatabases: 1, nameOnly: true, authorizedDatabases: true });
				names = (r.databases as { name: string }[]).map((d) => d.name);
			});
			check(
				"alpha lists only its own database",
				names.length === 1 && names[0] === alpha.dbName,
				names.join(","),
			);
		}

		console.log("\nStatement timeout (defaultMaxTimeMS)");
		{
			const c = new MongoClient(alphaUrl());
			await c.connect();
			const coll = c.db(alpha.dbName).collection("slow");
			await coll.insertMany(Array.from({ length: 400 }, (_, i) => ({ i })));
			const started = Date.now();
			let code: number | undefined;
			try {
				// 400 docs x 100ms = 40s of server-side JavaScript: longer than the limit.
				await coll.find({ $where: "sleep(100); return true;" }).toArray();
			} catch (e) {
				code = e instanceof MongoServerError ? Number(e.code) : -1;
			}
			const took = Date.now() - started;
			await coll.drop();
			await c.close();
			check(
				"a 40s $where query is killed by the server",
				code === 50 && took < LIMITS.STATEMENT_TIMEOUT_MS + 8_000,
				`code ${code}, ${(took / 1000).toFixed(1)}s`,
			);
		}

		console.log("\nStats (feeds quota enforcement and charts)");
		const stats = await readMongoStats(adminUrl, alpha.dbName);
		check("size reported", stats.sizeBytes > 0, `${stats.sizeBytes} bytes`);

		console.log("\nSuspend / resume (what the quota sweep does)");
		await suspendMongoDatabase(adminUrl, alpha.dbName, alpha.roleName);
		const whileSuspended = await attempt(alphaUrl(), (c) =>
			c.db(alpha.dbName).collection("t").findOne({}),
		);
		check("suspended tenant is denied", whileSuspended !== null, whileSuspended ?? "allowed!");
		await resumeMongoDatabase(adminUrl, alpha.dbName, alpha.roleName);
		const afterResume = await attempt(alphaUrl(), async (c) => {
			const doc = await c.db(alpha.dbName).collection("t").findOne({ x: 1 });
			if (!doc) throw new Error("data missing after resume");
		});
		check("resumed tenant reads its data again", afterResume === null, afterResume ?? "");

		console.log("\nPassword reset");
		const old = alpha.password;
		alpha.password = generatePassword();
		await resetMongoPassword(adminUrl, alpha.roleName, alpha.password);
		check(
			"old password no longer works",
			(await attempt(tenantUrl(alpha.dbName, alpha.roleName, old), (c) =>
				c.db(alpha.dbName).command({ ping: 1 }),
			)) !== null,
		);
		check(
			"new password works",
			(await attempt(alphaUrl(), (c) => c.db(alpha.dbName).command({ ping: 1 }))) === null,
		);
	} finally {
		console.log("\nCleanup");
		for (const t of tenants) {
			try {
				await deprovisionMongoDatabase(adminUrl, t.dbName, t.roleName);
				console.log(`  dropped ${t.dbName}`);
			} catch (e) {
				console.log(`  cleanup error ${t.dbName}: ${e}`);
			}
		}
		const c = new MongoClient(adminUrl);
		await c.connect();
		const left = await c.db("admin").command({ listDatabases: 1, nameOnly: true });
		const users = await c.db("admin").command({ usersInfo: { forAllDBs: true } });
		await c.close();
		const leftovers = (left.databases as { name: string }[])
			.map((d) => d.name)
			.filter((n) => n.startsWith("db_smoke"));
		const leftoverUsers = (users.users as { user: string }[])
			.map((u) => u.user)
			.filter((n) => n.startsWith("u_smoke"));
		check("no smoke databases left", leftovers.length === 0, leftovers.join(","));
		check("no smoke users left", leftoverUsers.length === 0, leftoverUsers.join(","));
	}

	console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
	return failures;
}

import { describe, expect, test } from "bun:test";
import { parsePortOverride, resolveTenantTarget } from "./dev-override";

const real = { host: "blaze-pg-1", port: 5433 };

describe("resolveTenantTarget", () => {
	test("leaves the target alone without overrides", () => {
		expect(resolveTenantTarget("postgres", real, { NODE_ENV: "development" })).toEqual(real);
	});

	test("redirects host and per-engine port in development", () => {
		const env = {
			NODE_ENV: "development",
			TENANT_HOST_OVERRIDE: "127.0.0.1",
			TENANT_PORT_OVERRIDE: "postgres=54321, mysql=33061",
		};
		expect(resolveTenantTarget("postgres", real, env)).toEqual({ host: "127.0.0.1", port: 54321 });
		expect(resolveTenantTarget("mariadb", real, env)).toEqual({ host: "127.0.0.1", port: 5433 });
	});

	test("is ignored in production", () => {
		const env = {
			NODE_ENV: "production",
			TENANT_HOST_OVERRIDE: "evil.example.com",
			TENANT_PORT_OVERRIDE: "postgres=1",
		};
		expect(resolveTenantTarget("postgres", real, env)).toEqual(real);
	});
});

describe("parsePortOverride", () => {
	test("rejects garbage", () => {
		expect(parsePortOverride("postgres=abc", "postgres")).toBeNull();
		expect(parsePortOverride("postgres=70000", "postgres")).toBeNull();
		expect(parsePortOverride(undefined, "postgres")).toBeNull();
	});
});

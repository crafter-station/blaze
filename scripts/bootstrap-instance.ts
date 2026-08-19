/**
 * Register a node and an engine instance in the control plane, and harden the instance.
 *
 * Run once per instance blaze should place tenants on. Idempotent: re-running updates the
 * existing rows rather than creating duplicates, so it is safe to use to rotate an admin
 * password or correct a host.
 *
 *   CONTROL_URL=postgresql://...        blaze's own database
 *   ENCRYPTION_KEY=<64 hex>             must match the app's
 *   NODE_NAME=vps-1
 *   INSTANCE_ENGINE=postgres
 *   INSTANCE_HOST=blaze-pg-1-yu7lyz     address blaze reaches it on, never public
 *   INSTANCE_PORT=5432
 *   INSTANCE_ADMIN_USER=blazeadmin
 *   INSTANCE_ADMIN_PASSWORD=...
 *   INSTANCE_VERSION=18
 *   HARDEN_URL=postgresql://...         optional: reachable admin URL to harden through
 *
 *   bun run scripts/bootstrap-instance.ts
 */

import { Client } from "pg";
import { encryptSecret } from "@/lib/crypto";
import { ENGINE_CONFIG, isEngine } from "@/lib/engines/types";
import { newId } from "@/lib/id";
import { isSupported, opsFor } from "@/lib/provision/engines";

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

const controlUrl = required("CONTROL_URL");
const nodeName = process.env.NODE_NAME ?? "vps-1";
const engine = required("INSTANCE_ENGINE");
if (!isEngine(engine)) throw new Error(`Unknown engine: ${engine}`);

const instanceHost = required("INSTANCE_HOST");
const instancePort = Number(process.env.INSTANCE_PORT ?? ENGINE_CONFIG[engine].port);
const adminUser = required("INSTANCE_ADMIN_USER");
const adminPassword = required("INSTANCE_ADMIN_PASSWORD");
const version = process.env.INSTANCE_VERSION ?? "unknown";

const control = new Client({ connectionString: controlUrl });
await control.connect();

try {
	// Node
	const existingNode = await control.query("select id from nodes where name = $1", [nodeName]);
	let nodeId: string;
	if (existingNode.rows.length > 0) {
		nodeId = existingNode.rows[0].id;
		await control.query("update nodes set internal_host = $2 where id = $1", [
			nodeId,
			instanceHost,
		]);
		console.log(`node   ${nodeName}  (existing ${nodeId})`);
	} else {
		nodeId = newId("node");
		await control.query(
			"insert into nodes (id, name, internal_host, status) values ($1, $2, $3, 'active')",
			[nodeId, nodeName, instanceHost],
		);
		console.log(`node   ${nodeName}  (created ${nodeId})`);
	}

	// Instance
	const tenancy = ENGINE_CONFIG[engine].tenancy;
	const existingInstance = await control.query(
		"select id from instances where internal_host = $1 and port = $2 and engine = $3",
		[instanceHost, instancePort, engine],
	);

	const encrypted = encryptSecret(adminPassword);

	if (existingInstance.rows.length > 0) {
		const id = existingInstance.rows[0].id;
		await control.query(
			`update instances set admin_user = $2, admin_password_enc = $3, version = $4,
			 status = 'active', tenancy = $5 where id = $1`,
			[id, adminUser, encrypted, version, tenancy],
		);
		console.log(`instance ${engine} ${instanceHost}:${instancePort}  (updated ${id})`);
	} else {
		const id = newId("inst");
		await control.query(
			`insert into instances
			 (id, node_id, engine, tenancy, version, internal_host, port, admin_user,
			  admin_password_enc, status)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
			[id, nodeId, engine, tenancy, version, instanceHost, instancePort, adminUser, encrypted],
		);
		console.log(`instance ${engine} ${instanceHost}:${instancePort}  (created ${id})`);
	}
} finally {
	await control.end();
}

// Hardening is idempotent and cheap, and an instance that skipped it leaks every tenant's
// database name to every other tenant — so it runs on every bootstrap, not just creation.
if (isSupported(engine)) {
	const hardenUrl = process.env.HARDEN_URL;
	if (hardenUrl) {
		await opsFor(engine).harden(hardenUrl);
		console.log(`hardened  ${engine} instance locked down`);
	} else {
		console.log("hardened  SKIPPED — set HARDEN_URL to a reachable admin connection string");
	}
}

console.log("done");

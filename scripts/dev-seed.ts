/**
 * Seed the local development stack from `docker-compose.dev.yaml`.
 *
 *   docker compose -f docker-compose.dev.yaml up -d
 *   bun run dev:seed -- --email blaze-ui-test+clerk_test@example.com
 *
 * Three things, all idempotent:
 *
 *  1. applies the Drizzle migrations to the **local** control database;
 *  2. creates the same small shop schema in every SQL engine, connected as the tenant role
 *     so ownership and grants match a real tenant (FKs, indexes, a JSON column, NULLs,
 *     ~1.2k orders and ~3k order items);
 *  3. registers a node, one instance per engine and one database per engine in the control
 *     database, owned by the Clerk user with that email.
 *
 * Instance rows carry production-shaped hosts (`blaze-dev-postgres:5433`), not the local
 * ports — run the app with TENANT_HOST_OVERRIDE / TENANT_PORT_OVERRIDE (see README) so the
 * dev-only redirect in lib/dev-override.ts sends the console to the containers.
 *
 * Refuses to touch a control database that is not on this machine: the app's own
 * DATABASE_URL is deliberately not read.
 */

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import mysql from "mysql2/promise";
import { Client } from "pg";
import { encryptSecret } from "@/lib/crypto";
import { ENGINE_CONFIG, type Engine } from "@/lib/engines/types";

const CONTROL_URL = process.env.DEV_CONTROL_URL || "postgresql://blaze:blaze@127.0.0.1:54320/blaze";
const TENANT = { db: "db_shop_dev", role: "u_shop_dev", password: "devpassword-shop" };

const LOCAL = {
	postgres: { host: "127.0.0.1", port: 54321 },
	mysql: { host: "127.0.0.1", port: 33061 },
	mariadb: { host: "127.0.0.1", port: 33062 },
	libsql: { host: "127.0.0.1", port: 58080 },
} as const;

type SqlEngine = keyof typeof LOCAL;

const DATABASE_IDS: Record<SqlEngine, string> = {
	postgres: "db_shopdevpgsq2",
	mysql: "db_shopdevmysq2",
	mariadb: "db_shopdevmria2",
	libsql: "db_shopdevsqit2",
};

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? undefined : process.argv[index + 1];
}

function assertLocal(url: string) {
	const host = new URL(url).hostname;
	if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
		throw new Error(`Refusing to seed a control database on ${host}: dev:seed is local-only.`);
	}
}

/* ------------------------------------------------------------------ *
 * Deterministic sample data
 * ------------------------------------------------------------------ */

function rng(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const FIRST = [
	"Ada",
	"Grace",
	"Linus",
	"Margaret",
	"Alan",
	"Barbara",
	"Ken",
	"Frances",
	"Dennis",
	"Radia",
	"Edsger",
	"Hedy",
	"Tim",
	"Katherine",
	"Donald",
	"Anita",
	"Guido",
	"Sophie",
	"Yukihiro",
	"Lucía",
	"Mateo",
	"Valentina",
	"Diego",
	"Camila",
];
const LAST = [
	"Lovelace",
	"Hopper",
	"Torvalds",
	"Hamilton",
	"Turing",
	"Liskov",
	"Thompson",
	"Allen",
	"Ritchie",
	"Perlman",
	"Dijkstra",
	"Lamarr",
	"Berners-Lee",
	"Johnson",
	"Knuth",
	"Borg",
	"van Rossum",
	"Wilson",
	"Matsumoto",
	"Ramírez",
	"Quispe",
	"Rojas",
	"Flores",
	"Torres",
];
const COUNTRIES = ["PE", "US", "MX", "ES", "AR", "CL", "CO", "DE", "GB", "JP", "BR", "CA"];
const CATEGORIES = [
	"keyboards",
	"mice",
	"monitors",
	"audio",
	"cables",
	"storage",
	"desks",
	"lighting",
];
const ADJECTIVES = [
	"Compact",
	"Pro",
	"Silent",
	"Wireless",
	"Ergonomic",
	"Ultra",
	"Mini",
	"Studio",
	"Travel",
	"Classic",
];
const STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled", "refunded"];
const COLORS = ["black", "white", "graphite", "sand", "forest", "amber"];

interface Data {
	customers: {
		id: number;
		email: string;
		full_name: string;
		country: string | null;
		marketing_opt_in: boolean;
		created_at: string;
	}[];
	products: {
		id: number;
		sku: string;
		name: string;
		category: string;
		price: string;
		attributes: string;
		created_at: string;
	}[];
	orders: {
		id: number;
		customer_id: number;
		status: string;
		total: string;
		shipping_address: string | null;
		created_at: string;
		shipped_at: string | null;
	}[];
	items: {
		id: number;
		order_id: number;
		product_id: number;
		quantity: number;
		unit_price: string;
	}[];
}

function timestamp(base: number, offsetMs: number): string {
	return new Date(base + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}

function buildData(): Data {
	const random = rng(20260706);
	const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
	const start = Date.UTC(2025, 0, 1);
	const year = 365 * 24 * 3600 * 1000;

	const customers: Data["customers"] = [];
	for (let id = 1; id <= 250; id++) {
		const first = pick(FIRST);
		const last = pick(LAST);
		customers.push({
			id,
			email: `${first}.${last}.${id}@example.com`.toLowerCase().replace(/[^a-z0-9.@-]/g, ""),
			full_name: `${first} ${last}`,
			// ~12% have never told us where they are.
			country: random() < 0.12 ? null : pick(COUNTRIES),
			marketing_opt_in: random() < 0.4,
			created_at: timestamp(start, random() * year * 0.5),
		});
	}

	const products: Data["products"] = [];
	for (let id = 1; id <= 60; id++) {
		const category = CATEGORIES[(id - 1) % CATEGORIES.length];
		const attributes: Record<string, unknown> = {
			color: pick(COLORS),
			weight_g: Math.round(80 + random() * 4000),
			tags: [category, pick(["new", "bestseller", "eco", "limited"])],
		};
		if (random() < 0.3)
			attributes.dimensions = { w: Math.round(random() * 60), h: Math.round(random() * 40) };
		products.push({
			id,
			sku: `${category.slice(0, 3).toUpperCase()}-${String(1000 + id)}`,
			name: `${pick(ADJECTIVES)} ${category.replace(/s$/, "")} ${id}`,
			category,
			price: (5 + random() * 495).toFixed(2),
			attributes: JSON.stringify(attributes),
			created_at: timestamp(start, random() * year * 0.25),
		});
	}

	const orders: Data["orders"] = [];
	const items: Data["items"] = [];
	let itemId = 1;
	for (let id = 1; id <= 1200; id++) {
		const status = pick(STATUSES);
		const createdOffset = year * 0.5 + random() * year * 0.5;
		const lines = 1 + Math.floor(random() * 4);
		let total = 0;
		for (let line = 0; line < lines; line++) {
			const product = pick(products);
			const quantity = 1 + Math.floor(random() * 3);
			total += Number(product.price) * quantity;
			items.push({
				id: itemId++,
				order_id: id,
				product_id: product.id,
				quantity,
				unit_price: product.price,
			});
		}
		const shipped = status === "shipped" || status === "delivered";
		orders.push({
			id,
			customer_id: 1 + Math.floor(random() * customers.length),
			status,
			total: total.toFixed(2),
			// Digital-only orders have no address: a JSON column with real NULLs in it.
			shipping_address:
				random() < 0.15
					? null
					: JSON.stringify({
							city: pick(["Lima", "Austin", "Madrid", "Tokyo", "Berlin", "Bogotá"]),
							line1: `${Math.floor(random() * 900) + 100} Main St`,
							postal_code: String(10000 + Math.floor(random() * 89999)),
						}),
			created_at: timestamp(start, createdOffset),
			shipped_at: shipped
				? timestamp(start, createdOffset + 86_400_000 * (1 + random() * 5))
				: null,
		});
	}

	return { customers, products, orders, items };
}

/* ------------------------------------------------------------------ *
 * Per-dialect DDL and inserts
 * ------------------------------------------------------------------ */

function literal(value: unknown, engine: SqlEngine): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "boolean")
		return engine === "libsql" ? (value ? "1" : "0") : value ? "TRUE" : "FALSE";
	if (typeof value === "number") return String(value);
	return `'${String(value).replace(/'/g, "''")}'`;
}

function inserts(
	table: string,
	rows: Record<string, unknown>[],
	engine: SqlEngine,
	chunk = 200,
): string[] {
	const out: string[] = [];
	const columns = Object.keys(rows[0]);
	for (let i = 0; i < rows.length; i += chunk) {
		const values = rows
			.slice(i, i + chunk)
			.map((row) => `(${columns.map((c) => literal(row[c], engine)).join(", ")})`)
			.join(",\n");
		out.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${values}`);
	}
	return out;
}

function ddl(engine: SqlEngine): string[] {
	if (engine === "postgres") {
		return [
			"DROP SCHEMA IF EXISTS analytics CASCADE",
			"DROP TABLE IF EXISTS order_items, orders, products, customers CASCADE",
			`CREATE TABLE customers (
				id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
				email text NOT NULL UNIQUE,
				full_name text NOT NULL,
				country char(2),
				marketing_opt_in boolean NOT NULL DEFAULT false,
				created_at timestamptz NOT NULL DEFAULT now()
			)`,
			`CREATE TABLE products (
				id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
				sku text NOT NULL UNIQUE,
				name text NOT NULL,
				category text NOT NULL,
				price numeric(10, 2) NOT NULL CHECK (price >= 0),
				attributes jsonb NOT NULL DEFAULT '{}',
				created_at timestamptz NOT NULL DEFAULT now()
			)`,
			`CREATE TABLE orders (
				id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
				customer_id integer NOT NULL REFERENCES customers (id),
				status text NOT NULL,
				total numeric(12, 2) NOT NULL,
				shipping_address jsonb,
				created_at timestamptz NOT NULL DEFAULT now(),
				shipped_at timestamptz
			)`,
			`CREATE TABLE order_items (
				id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
				order_id integer NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
				product_id integer NOT NULL REFERENCES products (id),
				quantity integer NOT NULL CHECK (quantity > 0),
				unit_price numeric(10, 2) NOT NULL
			)`,
			"CREATE INDEX orders_customer_id_idx ON orders (customer_id)",
			"CREATE INDEX orders_status_created_at_idx ON orders (status, created_at DESC)",
			"CREATE INDEX order_items_order_id_idx ON order_items (order_id)",
			"CREATE INDEX products_category_idx ON products (category)",
		];
	}
	if (engine === "libsql") {
		return [
			"DROP VIEW IF EXISTS daily_revenue",
			"DROP TABLE IF EXISTS order_items",
			"DROP TABLE IF EXISTS orders",
			"DROP TABLE IF EXISTS products",
			"DROP TABLE IF EXISTS customers",
			`CREATE TABLE customers (
				id INTEGER PRIMARY KEY,
				email TEXT NOT NULL UNIQUE,
				full_name TEXT NOT NULL,
				country TEXT,
				marketing_opt_in INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE products (
				id INTEGER PRIMARY KEY,
				sku TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				category TEXT NOT NULL,
				price REAL NOT NULL CHECK (price >= 0),
				attributes TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE orders (
				id INTEGER PRIMARY KEY,
				customer_id INTEGER NOT NULL REFERENCES customers (id),
				status TEXT NOT NULL,
				total REAL NOT NULL,
				shipping_address TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				shipped_at TEXT
			)`,
			`CREATE TABLE order_items (
				id INTEGER PRIMARY KEY,
				order_id INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
				product_id INTEGER NOT NULL REFERENCES products (id),
				quantity INTEGER NOT NULL CHECK (quantity > 0),
				unit_price REAL NOT NULL
			)`,
			"CREATE INDEX orders_customer_id_idx ON orders (customer_id)",
			"CREATE INDEX orders_status_created_at_idx ON orders (status, created_at DESC)",
			"CREATE INDEX order_items_order_id_idx ON order_items (order_id)",
			"CREATE INDEX products_category_idx ON products (category)",
		];
	}
	// MySQL and MariaDB share one dialect for this schema.
	return [
		"SET FOREIGN_KEY_CHECKS = 0",
		"DROP VIEW IF EXISTS daily_revenue",
		"DROP TABLE IF EXISTS order_items, orders, products, customers",
		"SET FOREIGN_KEY_CHECKS = 1",
		`CREATE TABLE customers (
			id INT AUTO_INCREMENT PRIMARY KEY,
			email VARCHAR(255) NOT NULL,
			full_name VARCHAR(255) NOT NULL,
			country CHAR(2),
			marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY customers_email_key (email)
		)`,
		`CREATE TABLE products (
			id INT AUTO_INCREMENT PRIMARY KEY,
			sku VARCHAR(32) NOT NULL,
			name VARCHAR(255) NOT NULL,
			category VARCHAR(64) NOT NULL,
			price DECIMAL(10, 2) NOT NULL,
			attributes JSON NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY products_sku_key (sku),
			KEY products_category_idx (category)
		)`,
		`CREATE TABLE orders (
			id INT AUTO_INCREMENT PRIMARY KEY,
			customer_id INT NOT NULL,
			status VARCHAR(16) NOT NULL,
			total DECIMAL(12, 2) NOT NULL,
			shipping_address JSON NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			shipped_at DATETIME NULL,
			KEY orders_customer_id_idx (customer_id),
			KEY orders_status_created_at_idx (status, created_at),
			CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers (id)
		)`,
		`CREATE TABLE order_items (
			id INT AUTO_INCREMENT PRIMARY KEY,
			order_id INT NOT NULL,
			product_id INT NOT NULL,
			quantity INT NOT NULL,
			unit_price DECIMAL(10, 2) NOT NULL,
			KEY order_items_order_id_idx (order_id),
			CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
			CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id)
		)`,
	];
}

function after(engine: SqlEngine): string[] {
	if (engine === "postgres") {
		return [
			...["customers", "products", "orders", "order_items"].map(
				(t) => `SELECT setval(pg_get_serial_sequence('${t}', 'id'), (SELECT max(id) FROM ${t}))`,
			),
			// A second schema, so the explorer has more than one to show.
			"CREATE SCHEMA analytics",
			`CREATE VIEW analytics.daily_revenue AS
				SELECT date_trunc('day', created_at)::date AS day, count(*) AS orders, sum(total) AS revenue
				FROM orders WHERE status IN ('paid', 'shipped', 'delivered')
				GROUP BY 1`,
			"ANALYZE",
		];
	}
	if (engine === "libsql") {
		return [
			`CREATE VIEW daily_revenue AS
				SELECT date(created_at) AS day, count(*) AS orders, sum(total) AS revenue
				FROM orders WHERE status IN ('paid', 'shipped', 'delivered')
				GROUP BY 1`,
		];
	}
	return [
		`CREATE VIEW daily_revenue AS
			SELECT DATE(created_at) AS day, COUNT(*) AS orders, SUM(total) AS revenue
			FROM orders WHERE status IN ('paid', 'shipped', 'delivered')
			GROUP BY DATE(created_at)`,
		"ANALYZE TABLE customers, products, orders, order_items",
	];
}

function script(engine: SqlEngine, data: Data): string[] {
	return [
		...ddl(engine),
		...inserts("customers", data.customers, engine),
		...inserts("products", data.products, engine),
		...inserts("orders", data.orders, engine),
		...inserts("order_items", data.items, engine),
		...after(engine),
	];
}

/* ------------------------------------------------------------------ *
 * Runners
 * ------------------------------------------------------------------ */

async function seedPostgres(statements: string[]) {
	const { host, port } = LOCAL.postgres;
	const client = new Client({
		host,
		port,
		user: TENANT.role,
		password: TENANT.password,
		database: TENANT.db,
		ssl: { rejectUnauthorized: false },
	});
	await client.connect();
	try {
		for (const sql of statements) await client.query(sql);
	} finally {
		await client.end();
	}
}

async function seedMysql(engine: "mysql" | "mariadb", statements: string[]) {
	const { host, port } = LOCAL[engine];
	const conn = await mysql.createConnection({
		host,
		port,
		user: TENANT.role,
		password: TENANT.password,
		database: TENANT.db,
		ssl: { rejectUnauthorized: false },
	});
	try {
		for (const sql of statements) await conn.query(sql);
	} finally {
		await conn.end();
	}
}

async function seedLibsql(statements: string[]) {
	const { host, port } = LOCAL.libsql;
	const client = createClient({ url: `http://${host}:${port}` });
	try {
		await client.batch(statements, "write");
	} finally {
		client.close();
	}
}

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fn();
		} catch (error) {
			if (attempt >= 30) throw error;
			if (attempt === 1) console.log(`  waiting for ${label}…`);
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
	}
}

/* ------------------------------------------------------------------ *
 * Control plane
 * ------------------------------------------------------------------ */

async function clerkUserId(email: string): Promise<string> {
	const key = process.env.CLERK_SECRET_KEY;
	if (!key) throw new Error("CLERK_SECRET_KEY is required to look up the owner by email");
	if (!key.startsWith("sk_test_")) {
		throw new Error("dev:seed only runs against a Clerk development instance (sk_test_ key)");
	}
	const response = await fetch(
		`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
		{ headers: { Authorization: `Bearer ${key}` } },
	);
	if (!response.ok) throw new Error(`Clerk lookup failed: ${response.status}`);
	const users = (await response.json()) as { id: string }[];
	if (!users[0]) throw new Error(`No Clerk user with email ${email} in the development instance`);
	return users[0].id;
}

async function registerControlRows(email: string) {
	const control = new Client({ connectionString: CONTROL_URL });
	await control.connect();
	try {
		const clerkId = await clerkUserId(email);
		const user = await control.query(
			`INSERT INTO users (id, clerk_user_id, email) VALUES ($1, $2, $3)
			 ON CONFLICT (clerk_user_id) DO UPDATE SET email = EXCLUDED.email
			 RETURNING id`,
			[`usr_dev${clerkId.slice(-9).toLowerCase()}`, clerkId, email],
		);
		const userId: string = user.rows[0].id;

		await control.query(
			`INSERT INTO nodes (id, name, internal_host) VALUES ('node_devlocal', 'dev-local', 'localhost')
			 ON CONFLICT (id) DO NOTHING`,
		);

		const project = await control.query(
			`INSERT INTO projects (id, owner_user_id, slug, name) VALUES ($1, $2, 'default', 'Default')
			 ON CONFLICT (owner_user_id, slug) DO UPDATE SET name = projects.name
			 RETURNING id`,
			[`proj_dev${userId.slice(-8)}`, userId],
		);
		const projectId: string = project.rows[0].id;

		for (const engine of Object.keys(LOCAL) as SqlEngine[]) {
			const config = ENGINE_CONFIG[engine as Engine];
			const instanceId = `inst_dev${engine}`;
			await control.query(
				`INSERT INTO instances (id, node_id, engine, tenancy, version, internal_host, port, admin_user, admin_password_enc, status)
				 VALUES ($1, 'node_devlocal', $2, $3, 'dev', $4, $5, 'blazeadmin', $6, 'active')
				 ON CONFLICT (id) DO UPDATE SET internal_host = EXCLUDED.internal_host, port = EXCLUDED.port`,
				[
					instanceId,
					engine,
					config.tenancy,
					`blaze-dev-${engine}`,
					config.port,
					encryptSecret("unused-in-dev"),
				],
			);
			await control.query(
				`INSERT INTO databases (id, project_id, owner_user_id, slug, name, engine, tenancy, instance_id, db_name, role_name, password_enc, status)
				 VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, 'active')
				 ON CONFLICT (id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, project_id = EXCLUDED.project_id,
				   password_enc = EXCLUDED.password_enc, status = 'active', deleted_at = NULL`,
				[
					DATABASE_IDS[engine],
					projectId,
					userId,
					`shop-${engine}`,
					engine,
					config.tenancy,
					instanceId,
					TENANT.db,
					TENANT.role,
					encryptSecret(TENANT.password),
				],
			);
			console.log(`  ${engine.padEnd(8)} /databases/${DATABASE_IDS[engine]}/sql`);
		}
	} finally {
		await control.end();
	}
}

/* ------------------------------------------------------------------ */

assertLocal(CONTROL_URL);
const email = arg("email") ?? process.env.E2E_EMAIL;
const only = arg("only")?.split(",") as SqlEngine[] | undefined;

console.log("control: migrating");
await retry("control database", async () => {
	const client = new Client({ connectionString: CONTROL_URL });
	await client.connect();
	try {
		await migrate(drizzle(client), { migrationsFolder: "drizzle" });
	} finally {
		await client.end();
	}
});

const data = buildData();
console.log(
	`tenants: ${data.customers.length} customers, ${data.products.length} products, ${data.orders.length} orders, ${data.items.length} items`,
);
for (const engine of (only ?? (Object.keys(LOCAL) as SqlEngine[])) as SqlEngine[]) {
	const statements = script(engine, data);
	await retry(engine, () => {
		if (engine === "postgres") return seedPostgres(statements);
		if (engine === "libsql") return seedLibsql(statements);
		return seedMysql(engine, statements);
	});
	console.log(`  ${engine} seeded`);
}

if (email) {
	console.log(`control: registering databases for ${email}`);
	await registerControlRows(email);
} else {
	console.log("control: pass --email <clerk dev user> to register the databases");
}

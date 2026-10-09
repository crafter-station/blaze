/**
 * Seed data for the local MongoDB from `docker-compose.dev.yaml`, used by `dev-seed.ts`.
 *
 * The tenant is created exactly the way production creates one (`provisionMongoDatabase`:
 * a database plus a user with `dbOwner` on it), and the data is then written **as that
 * tenant**. The instance is hardened the way bootstrap hardens production
 * (`defaultMaxTimeMS`).
 *
 * The collections are chosen for what the browser and shell have to render: nested
 * documents, arrays of subdocuments, ObjectId references, dates, Decimal128, Long, Binary,
 * nulls, heterogeneous shapes, a unique index, a compound index and a TTL index, plus one
 * collection (`orders`) with ~2k documents so paging has real work to do.
 *
 * Idempotent: the tenant database and user are dropped and recreated.
 */

import { Binary, Decimal128, Long, MongoClient, ObjectId } from "mongodb";
import { hardenMongoInstance, provisionMongoDatabase } from "@/lib/provision/mongo";

export const MONGO_LOCAL = { host: "127.0.0.1", port: 27018 } as const;
export const MONGO_ADMIN_PASSWORD = "devpassword-blazeadmin";
export const MONGO_TENANT = {
	db: "db_app_dev",
	role: "u_app_dev",
	password: "devpassword-app",
} as const;

const TLS = "tls=true&tlsAllowInvalidCertificates=true&directConnection=true";
const ADMIN_URL = `mongodb://blazeadmin:${MONGO_ADMIN_PASSWORD}@${MONGO_LOCAL.host}:${MONGO_LOCAL.port}/admin?${TLS}&authSource=admin`;
const TENANT_URL = `mongodb://${MONGO_TENANT.role}:${MONGO_TENANT.password}@${MONGO_LOCAL.host}:${MONGO_LOCAL.port}/${MONGO_TENANT.db}?${TLS}&authSource=${MONGO_TENANT.db}`;

function rng(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const FIRST = ["Ada", "Grace", "Linus", "Margaret", "Alan", "Barbara", "Radia", "Hedy", "Lucía"];
const LAST = ["Lovelace", "Hopper", "Torvalds", "Hamilton", "Turing", "Liskov", "Quispe", "Rojas"];
const CITIES = [
	{ city: "Lima", country: "PE", geo: [-77.04, -12.05] },
	{ city: "Austin", country: "US", geo: [-97.74, 30.27] },
	{ city: "Madrid", country: "ES", geo: [-3.7, 40.42] },
	{ city: "Ciudad de México", country: "MX", geo: [-99.13, 19.43] },
	{ city: "Berlin", country: "DE", geo: [13.4, 52.52] },
	{ city: "Tokyo", country: "JP", geo: [139.69, 35.69] },
];
const TAGS = ["beta", "vip", "newsletter", "churn-risk", "enterprise", "early-adopter"];
const STATUSES = ["pending", "paid", "paid", "paid", "shipped", "shipped", "delivered", "refunded"];
const CATEGORIES = ["keyboards", "mice", "monitors", "audio", "cables", "desks"];

/** Fixed epoch so reseeding produces the same dates. */
const EPOCH = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

/**
 * Deterministic but realistic ObjectIds: a plausible creation time, then bytes from a
 * per-collection generator, so references between collections are stable across reseeds.
 */
function objectId(prefix: number, n: number): ObjectId {
	const seconds = Math.floor((EPOCH - 400 * DAY) / 1000) + n * 3607 + (prefix % 997);
	const tail = rng(prefix * 100_003 + n);
	let hex = seconds.toString(16).padStart(8, "0");
	for (let i = 0; i < 16; i++) hex += Math.floor(tail() * 16).toString(16);
	return new ObjectId(hex);
}

export async function seedMongo(): Promise<{ documents: number }> {
	await hardenMongoInstance(ADMIN_URL);

	const admin = new MongoClient(ADMIN_URL, { serverSelectionTimeoutMS: 5_000 });
	await admin.connect();
	try {
		await admin
			.db(MONGO_TENANT.db)
			.command({ dropUser: MONGO_TENANT.role })
			.catch(() => {});
		await admin.db(MONGO_TENANT.db).dropDatabase();
	} finally {
		await admin.close();
	}

	await provisionMongoDatabase({
		adminUrl: ADMIN_URL,
		dbName: MONGO_TENANT.db,
		roleName: MONGO_TENANT.role,
		password: MONGO_TENANT.password,
	});

	const random = rng(7);
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];

	const tenant = new MongoClient(TENANT_URL, { serverSelectionTimeoutMS: 5_000 });
	await tenant.connect();
	try {
		const db = tenant.db(MONGO_TENANT.db);

		const users = Array.from({ length: 300 }, (_, i) => {
			const first = pick(FIRST);
			const last = pick(LAST);
			const place = pick(CITIES);
			return {
				_id: objectId(0x75736572, i + 1),
				email: `${first}.${last}.${i + 1}@example.com`.toLowerCase().replace(/[^a-z0-9.@]/g, ""),
				name: { first, last },
				age: 18 + Math.floor(random() * 60),
				plan: pick(["free", "free", "free", "pro", "team"] as const),
				address: {
					city: place.city,
					country: place.country,
					location: { type: "Point", coordinates: place.geo },
				},
				tags: TAGS.filter(() => random() < 0.25),
				settings: { theme: pick(["dark", "light", "system"]), notifications: random() < 0.7 },
				createdAt: new Date(EPOCH - Math.floor(random() * 400) * DAY),
				lastLoginAt: random() < 0.1 ? null : new Date(EPOCH + Math.floor(random() * 200) * DAY),
				...(random() < 0.15 && {
					referredBy: objectId(0x75736572, 1 + Math.floor(random() * 300)),
				}),
			};
		});
		await db.collection("users").insertMany(users);
		await db.collection("users").createIndex({ email: 1 }, { unique: true, name: "email_unique" });

		const products = Array.from({ length: 120 }, (_, i) => {
			const category = pick(CATEGORIES);
			const base = 10 + Math.floor(random() * 490);
			return {
				_id: objectId(0x70726f64, i + 1),
				sku: `SKU-${String(i + 1).padStart(4, "0")}`,
				name: `${pick(["Pro", "Mini", "Ultra", "Classic", "Studio"])} ${category.slice(0, -1)} ${i + 1}`,
				category,
				price: Decimal128.fromString(
					`${base}.${String(Math.floor(random() * 100)).padStart(2, "0")}`,
				),
				stock: Math.floor(random() * 500),
				active: random() < 0.9,
				variants: Array.from({ length: 1 + Math.floor(random() * 3) }, (_, v) => ({
					color: pick(["black", "white", "graphite", "sand"]),
					sku: `SKU-${String(i + 1).padStart(4, "0")}-${v + 1}`,
					weightGrams: 100 + Math.floor(random() * 2000),
				})),
				ratings: {
					average: Math.round((2.5 + random() * 2.5) * 10) / 10,
					count: Math.floor(random() * 900),
				},
			};
		});
		await db.collection("products").insertMany(products);
		await db
			.collection("products")
			.createIndex({ category: 1, price: -1 }, { name: "category_price" });

		const orders = Array.from({ length: 2000 }, (_, i) => {
			const user = pick(users);
			const lines = Array.from({ length: 1 + Math.floor(random() * 4) }, () => {
				const product = pick(products);
				return {
					productId: product._id,
					sku: product.sku,
					qty: 1 + Math.floor(random() * 3),
					unitPrice: product.price,
				};
			});
			const status = pick(STATUSES);
			const placedAt = new Date(
				EPOCH + Math.floor(random() * 270) * DAY + Math.floor(random() * DAY),
			);
			return {
				_id: objectId(0x6f726472, i + 1),
				number: 10_000 + i,
				userId: user._id,
				status,
				items: lines,
				total:
					Math.round(
						lines.reduce((sum, l) => sum + l.qty * Number(l.unitPrice.toString()), 0) * 100,
					) / 100,
				currency: "USD",
				shipping: {
					method: pick(["standard", "express", "pickup"]),
					address: { city: user.address.city, country: user.address.country },
					...(status === "shipped" || status === "delivered"
						? { trackingCode: `TRK${Math.floor(random() * 1e9)}` }
						: {}),
				},
				placedAt,
				...(status === "delivered" && { deliveredAt: new Date(placedAt.getTime() + 3 * DAY) }),
				...(random() < 0.05 && { notes: "Leave at the front desk" }),
			};
		});
		await db.collection("orders").insertMany(orders);
		await db.collection("orders").createIndex({ userId: 1 }, { name: "userId_1" });
		await db
			.collection("orders")
			.createIndex({ status: 1, placedAt: -1 }, { name: "status_placedAt" });

		// Heterogeneous on purpose: the table view has to cope with shapes that disagree.
		const events = Array.from({ length: 400 }, (_, i) => {
			const kind = pick(["page_view", "signup", "purchase", "error", "webhook"] as const);
			const base = {
				_id: objectId(0x65766e74, i + 1),
				kind,
				at: new Date(EPOCH + Math.floor(random() * 90 * DAY)),
				userId: random() < 0.8 ? pick(users)._id : null,
			};
			switch (kind) {
				case "page_view":
					return {
						...base,
						path: pick(["/", "/pricing", "/docs", "/blog/launch"]),
						durationMs: Math.floor(random() * 30_000),
					};
				case "signup":
					return { ...base, source: pick(["google", "github", "email"]), referrer: null };
				case "purchase":
					return {
						...base,
						amountCents: Long.fromNumber(Math.floor(random() * 50_000_00)),
						orderId: pick(orders)._id,
					};
				case "error":
					return {
						...base,
						error: {
							code: pick(["E_TIMEOUT", "E_AUTH", "E_RATE"]),
							stack: ["at handler (app.ts:12)", "at run (server.ts:88)"],
						},
						retryable: random() < 0.5,
					};
				default:
					return {
						...base,
						payload: new Binary(Buffer.from(`hook-${i}`)),
						attempts: [1, 2, 3].slice(0, 1 + Math.floor(random() * 3)),
					};
			}
		});
		await db.collection("events").insertMany(events);
		await db
			.collection("events")
			.createIndex({ at: 1 }, { name: "at_ttl", expireAfterSeconds: 60 * 60 * 24 * 365 * 10 });

		return { documents: users.length + products.length + orders.length + events.length };
	} finally {
		await tenant.close();
	}
}

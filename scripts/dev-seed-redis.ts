/**
 * Seed data for the local Redis from `docker-compose.dev.yaml`, used by `dev-seed.ts`.
 *
 * Written as the tenant (`default`), like everything a real tenant stores. Covers every
 * type the browser and console have to render: plain, JSON and binary strings, counters,
 * lists, hashes, sets, sorted sets, a stream with a consumer group and pending entries,
 * ReJSON documents, a time series and a Bloom filter (module types the browser shows
 * raw), keys with TTLs, and a few awkward names. A few thousand keys across `user:*`,
 * `session:*`, `cache:*` and friends, so SCAN paging and the namespace tree have real
 * work to do.
 *
 * Idempotent: the database is flushed first.
 */

import Redis from "ioredis";

export const REDIS_LOCAL = { host: "127.0.0.1", port: 63791 } as const;
export const REDIS_TENANT = { user: "default", password: "devpassword-cache" } as const;
export const REDIS_ADMIN_PASSWORD = "devpassword-blazeadmin";

function rng(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const NAMES = [
	"Ada",
	"Grace",
	"Linus",
	"Margaret",
	"Alan",
	"Barbara",
	"Ken",
	"Radia",
	"Hedy",
	"Lucía",
	"Mateo",
	"Camila",
];
const SURNAMES = [
	"Lovelace",
	"Hopper",
	"Torvalds",
	"Hamilton",
	"Turing",
	"Liskov",
	"Perlman",
	"Lamarr",
	"Quispe",
	"Rojas",
];
const COUNTRIES = ["PE", "US", "MX", "ES", "AR", "CL", "DE", "JP", "BR"];
const PLANS = ["free", "free", "free", "pro", "team"];

export async function seedRedis(): Promise<{ keys: number }> {
	const redis = new Redis({
		host: REDIS_LOCAL.host,
		port: REDIS_LOCAL.port,
		username: REDIS_TENANT.user,
		password: REDIS_TENANT.password,
		tls: { rejectUnauthorized: false },
		lazyConnect: true,
		maxRetriesPerRequest: 1,
		retryStrategy: () => null,
	});
	await redis.connect();
	const random = rng(20261007);
	const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
	const token = (n = 32) =>
		Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(random() * 16)]).join("");

	try {
		await redis.flushdb();
		let p = redis.pipeline();
		const flush = async () => {
			await p.exec();
			p = redis.pipeline();
		};

		// Users: one hash each, plus a followers set for some.
		for (let id = 1; id <= 1500; id++) {
			const first = pick(NAMES);
			const last = pick(SURNAMES);
			p.hset(`user:${id}`, {
				name: `${first} ${last}`,
				email: `${first}.${last}.${id}@example.com`.toLowerCase(),
				country: pick(COUNTRIES),
				plan: pick(PLANS),
				created_at: new Date(Date.UTC(2025, 0, 1) + Math.floor(random() * 3e10)).toISOString(),
				logins: String(Math.floor(random() * 400)),
			});
			if (id <= 120) {
				const followers = Array.from({ length: 3 + Math.floor(random() * 40) }, () =>
					String(1 + Math.floor(random() * 1500)),
				);
				p.sadd(`user:${id}:followers`, ...followers);
			}
			if (id % 250 === 0) await flush();
		}

		// Sessions: short-lived strings holding JSON, every one with a TTL.
		for (let i = 0; i < 1200; i++) {
			const sid = token();
			p.set(
				`session:${sid}`,
				JSON.stringify({
					userId: 1 + Math.floor(random() * 1500),
					ip: `10.0.${Math.floor(random() * 255)}.${Math.floor(random() * 255)}`,
					ua: pick(["Firefox", "Chrome", "Safari"]),
				}),
				"EX",
				600 + Math.floor(random() * 86_400),
			);
			if (i % 300 === 0) await flush();
		}

		// Cache entries: JSON strings, most with a TTL, a few without.
		for (let id = 1; id <= 400; id++) {
			const value = JSON.stringify({
				id,
				sku: `SKU-${1000 + id}`,
				name: `${pick(["Compact", "Pro", "Silent", "Wireless", "Studio"])} ${pick(["keyboard", "mouse", "monitor", "desk"])}`,
				price: Number((5 + random() * 400).toFixed(2)),
				tags: [pick(["new", "sale", "eco"]), pick(["bestseller", "limited"])],
				stock: { warehouse: pick(["LIM", "AUS", "MAD"]), units: Math.floor(random() * 90) },
			});
			if (id % 10 === 0) p.set(`cache:product:${id}`, value);
			else p.set(`cache:product:${id}`, value, "EX", 3600 + Math.floor(random() * 7200));
		}
		p.set(
			"cache:homepage:html",
			"<!doctype html><html><body><h1>Welcome</h1></body></html>",
			"EX",
			300,
		);
		await flush();

		// Rate limits: counters that expire within a minute.
		for (let i = 0; i < 60; i++) {
			p.set(
				`ratelimit:ip:10.1.${i}.${Math.floor(random() * 255)}`,
				String(Math.floor(random() * 90)),
				"EX",
				30 + Math.floor(random() * 60),
			);
		}

		// Plain strings, counters, binary.
		p.set("stats:visits", "184223");
		p.set("stats:signups:today", "57");
		p.set("feature:flags", "dark-mode,new-checkout,beta-search");
		p.set("greeting", "Hello from blaze. This is a plain string value.");
		p.set("long:text", "Lorem ipsum dolor sit amet. ".repeat(400));
		// A PNG header followed by noise: not UTF-8, so the browser shows hex.
		const png = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.from(Array.from({ length: 248 }, () => Math.floor(random() * 256))),
		]);
		p.set("blob:avatar:1", png);
		p.set(Buffer.from([0x62, 0x69, 0x6e, 0x3a, 0xff, 0xfe, 0x01]), "a key whose name is not UTF-8");
		p.set("key with spaces", "names can contain spaces");
		p.set("emoji:🔥", "names can be unicode");

		// Lists: a queue and a log.
		p.rpush(
			"queue:emails",
			...Array.from({ length: 300 }, (_, i) =>
				JSON.stringify({
					to: `user${i}@example.com`,
					template: pick(["welcome", "reset", "digest"]),
				}),
			),
		);
		p.rpush("queue:jobs:pending", ...Array.from({ length: 25 }, (_, i) => `job-${i + 1}`));
		p.lpush(
			"log:deploys",
			"v1.4.0 deployed",
			"v1.4.1 deployed",
			"v1.5.0 rolled back",
			"v1.5.1 deployed",
		);

		// Sorted sets.
		const players = Array.from({ length: 500 }, (_, i) => [
			Math.floor(random() * 100_000),
			`player:${i + 1}`,
		]).flat();
		p.zadd("leaderboard:alltime", ...(players as (string | number)[]));
		p.zadd(
			"leaderboard:weekly",
			...(Array.from({ length: 50 }, (_, i) => [
				Number((random() * 1000).toFixed(1)),
				`player:${i + 1}`,
			]).flat() as (string | number)[]),
		);
		p.zadd(
			"schedule:reminders",
			...(Array.from({ length: 30 }, (_, i) => [
				Date.now() + i * 3_600_000,
				`reminder:${i + 1}`,
			]).flat() as (string | number)[]),
		);

		// Sets.
		p.sadd("tags:all", "redis", "postgres", "mysql", "sqlite", "cache", "queue", "stream", "json");
		p.sadd(
			"online:users",
			...Array.from({ length: 80 }, () => String(1 + Math.floor(random() * 1500))),
		);
		await flush();

		// A stream with a consumer group, some delivered and some still pending.
		for (let i = 0; i < 500; i++) {
			p.xadd(
				"events:orders",
				"*",
				"order_id",
				String(1000 + i),
				"status",
				pick(["created", "paid", "shipped"]),
				"total",
				(10 + random() * 300).toFixed(2),
			);
		}
		p.xadd("events:audit", "*", "actor", "user:1", "action", "login");
		await flush();
		await redis.xgroup("CREATE", "events:orders", "fulfillment", "0");
		await redis.xgroup("CREATE", "events:orders", "analytics", "$");
		await redis.xreadgroup(
			"GROUP",
			"fulfillment",
			"worker-1",
			"COUNT",
			40,
			"STREAMS",
			"events:orders",
			">",
		);
		const delivered = (await redis.xreadgroup(
			"GROUP",
			"fulfillment",
			"worker-2",
			"COUNT",
			15,
			"STREAMS",
			"events:orders",
			">",
		)) as [string, [string, string[]][]][] | null;
		// worker-2 acknowledges a few of its entries; the rest stay pending.
		const ids = delivered?.[0]?.[1].map(([id]) => id) ?? [];
		if (ids.length) await redis.xack("events:orders", "fulfillment", ...ids.slice(0, 5));

		// ReJSON documents.
		for (let id = 1; id <= 50; id++) {
			const doc = {
				id,
				customer: {
					id: 1 + Math.floor(random() * 1500),
					name: `${pick(NAMES)} ${pick(SURNAMES)}`,
					vip: random() < 0.2,
				},
				items: Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
					sku: `SKU-${1000 + Math.floor(random() * 400)}`,
					qty: 1 + Math.floor(random() * 3),
				})),
				status: pick(["pending", "paid", "shipped"]),
				notes: random() < 0.3 ? null : "Leave at the door",
			};
			p.call("JSON.SET", `doc:order:${id}`, "$", JSON.stringify(doc));
		}
		p.call(
			"JSON.SET",
			"config:app",
			"$",
			JSON.stringify({
				name: "shop",
				version: 3,
				features: { search: true, checkout: { provider: "stripe", retries: 3 } },
				regions: ["us-east", "sa-east"],
				maintenance: false,
			}),
		);
		await flush();

		// Module types the browser shows raw, with a hint to use the console.
		await redis.call(
			"TS.CREATE",
			"ts:cpu:web-1",
			"RETENTION",
			"86400000",
			"LABELS",
			"host",
			"web-1",
		);
		for (let i = 0; i < 60; i++)
			p.call(
				"TS.ADD",
				"ts:cpu:web-1",
				String(Date.now() - (60 - i) * 60_000),
				(20 + random() * 60).toFixed(1),
			);
		p.call("BF.RESERVE", "bf:emails:seen", "0.01", "10000");
		p.call(
			"BF.MADD",
			"bf:emails:seen",
			"ada@example.com",
			"grace@example.com",
			"linus@example.com",
		);
		await flush();

		return { keys: await redis.dbsize() };
	} finally {
		redis.disconnect();
	}
}

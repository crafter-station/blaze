import { describe, expect, test } from "bun:test";
import { LiteralParseError } from "./literal";
import { parseShell } from "./shell";

const fail = (source: string): LiteralParseError => {
	try {
		parseShell(source);
	} catch (e) {
		expect(e).toBeInstanceOf(LiteralParseError);
		return e as LiteralParseError;
	}
	throw new Error(`expected "${source}" to fail`);
};

describe("parseShell: collection methods", () => {
	test("find with chained cursor methods", () => {
		expect(
			parseShell(
				"db.orders.find({ status: 'paid' }, { total: 1 }).sort({ placedAt: -1 }).skip(20).limit(10).toArray();",
			),
		).toEqual({
			type: "collection",
			collection: "orders",
			method: "find",
			args: [{ status: "paid" }, { total: 1 }],
			cursor: { sort: { placedAt: -1 }, skip: 20, limit: 10 },
		});
	});

	test("find() defaults its filter; .project and .count", () => {
		const cmd = parseShell("db.users.find().project({ email: 1 }).count()");
		expect(cmd).toMatchObject({
			method: "find",
			args: [{}],
			cursor: { projection: { email: 1 }, count: true },
		});
	});

	test("every method family parses", () => {
		const cases: [string, string][] = [
			["db.c.findOne({ _id: ObjectId('6ac945381d3fd16de924a6a7') })", "findOne"],
			["db.c.aggregate([{ $match: {} }, { $count: 'n' }])", "aggregate"],
			["db.c.countDocuments({ a: { $gt: 1 } })", "countDocuments"],
			["db.c.estimatedDocumentCount()", "estimatedDocumentCount"],
			["db.c.distinct('status', { a: 1 })", "distinct"],
			["db.c.insertOne({ a: 1 })", "insertOne"],
			["db.c.insertMany([{ a: 1 }, { a: 2 }])", "insertMany"],
			["db.c.updateOne({ a: 1 }, { $set: { b: 2 } }, { upsert: true })", "updateOne"],
			["db.c.updateMany({}, [{ $set: { b: '$a' } }])", "updateMany"],
			["db.c.replaceOne({ a: 1 }, { a: 1, b: 2 })", "replaceOne"],
			["db.c.deleteOne({ a: 1 })", "deleteOne"],
			["db.c.deleteMany({})", "deleteMany"],
			["db.c.createIndex({ a: 1, b: -1 }, { unique: true })", "createIndex"],
			["db.c.dropIndex('a_1')", "dropIndex"],
			["db.c.getIndexes()", "getIndexes"],
			["db.c.drop()", "drop"],
		];
		for (const [source, method] of cases) {
			expect(parseShell(source)).toMatchObject({ type: "collection", collection: "c", method });
		}
	});

	test("variadic aggregate stages are wrapped into a pipeline", () => {
		expect(parseShell("db.c.aggregate({ $match: {} }, { $limit: 1 })")).toMatchObject({
			args: [[{ $match: {} }, { $limit: 1 }]],
		});
		expect(parseShell("db.c.aggregate()")).toMatchObject({ args: [[]] });
	});

	test("collection names: getCollection, brackets and dotted names", () => {
		expect(parseShell('db.getCollection("my coll").find()')).toMatchObject({
			collection: "my coll",
		});
		expect(parseShell("db['odd-name'].getIndexes()")).toMatchObject({ collection: "odd-name" });
		expect(parseShell("db.system.profile.find()")).toMatchObject({ collection: "system.profile" });
		// A collection named like a db method is reachable through getCollection.
		expect(parseShell('db.getCollection("stats").find()')).toMatchObject({ collection: "stats" });
	});

	test("argument shapes are checked", () => {
		expect(fail("db.c.updateOne({ a: 1 }, { b: 2 })").message).toMatch(/operators/);
		expect(fail("db.c.replaceOne({}, { $set: { b: 2 } })").message).toMatch(/replacement/);
		expect(fail("db.c.insertMany({ a: 1 })").message).toMatch(/array/);
		expect(fail("db.c.insertMany([])").message).toMatch(/at least one/);
		expect(fail("db.c.insertOne()").message).toMatch(/takes 1 to 2/);
		expect(fail("db.c.distinct({ a: 1 })").message).toMatch(/field name/);
		expect(fail("db.c.find(1)").message).toMatch(/filter/);
		expect(fail("db.c.createIndex({})").message).toMatch(/at least one field/);
		expect(fail("db.c.find().limit('x')").message).toMatch(/integer/);
		expect(fail("db.c.aggregate([]).sort({ a: 1 })").message).toMatch(/aggregate/);
		expect(fail("db.c.insertOne({ a: 1 }).limit(1)").message).toMatch(/only follow find/);
	});
});

describe("parseShell: database level", () => {
	test("db methods", () => {
		expect(parseShell("db.getCollectionNames()")).toEqual({
			type: "db",
			method: "getCollectionNames",
			args: [],
		});
		expect(parseShell("db.createCollection('logs', { capped: true, size: 4096 })")).toMatchObject({
			type: "db",
			method: "createCollection",
			args: ["logs", { capped: true, size: 4096 }],
		});
		expect(parseShell("db.stats()")).toMatchObject({ method: "stats" });
		expect(parseShell("db.dropDatabase()")).toMatchObject({ method: "dropDatabase" });
	});

	test("show collections / show dbs", () => {
		expect(parseShell("show collections")).toEqual({ type: "show", what: "collections" });
		expect(parseShell("  SHOW tables; ")).toEqual({ type: "show", what: "collections" });
		expect(parseShell("show dbs")).toEqual({ type: "show", what: "dbs" });
		expect(fail("show users").message).toMatch(/not supported/);
	});

	test("raw command documents and runCommand", () => {
		expect(parseShell('{ "ping": 1 }')).toEqual({ type: "command", command: { ping: 1 } });
		expect(parseShell("db.runCommand({ dbStats: 1, scale: 1024 })")).toEqual({
			type: "command",
			command: { dbStats: 1, scale: 1024 },
		});
		expect(parseShell("db.runCommand('ping')")).toEqual({ type: "command", command: { ping: 1 } });
		expect(fail("{}").message).toMatch(/command name/);
	});
});

describe("parseShell: refusals", () => {
	test("streams and persistent cursors are recognised and blocked", () => {
		expect(parseShell("db.c.watch()")).toMatchObject({ type: "blocked" });
		expect(parseShell("db.watch()")).toMatchObject({ type: "blocked" });
		expect(parseShell("db.c.find().tailable()")).toMatchObject({ type: "blocked" });
		expect(parseShell("db.c.find({}, {}, { tailable: true })")).toMatchObject({ type: "blocked" });
		expect(parseShell("db.c.find().addCursorFlag('tailable', true)")).toMatchObject({
			type: "blocked",
		});
		expect(parseShell("db.c.aggregate([{ $changeStream: {} }])")).toMatchObject({
			type: "blocked",
		});
		expect(parseShell("db.c.find().forEach(printjson)")).toMatchObject({ type: "blocked" });
		expect(parseShell("db.adminCommand({ listDatabases: 1 })")).toMatchObject({ type: "blocked" });
	});

	test("JavaScript and other databases are explained, not run", () => {
		expect(fail("use admin").message).toMatch(/already connected/);
		expect(fail("var x = 1").message).toMatch(/does not run JavaScript/);
		expect(fail("db.c.find(); db.d.find()").message).toMatch(/one command at a time/);
		expect(fail("db.c").message).toMatch(/Add a method/);
		expect(fail("db.c.frobnicate()").message).toMatch(/not supported on a collection/);
		expect(fail("db.frobnicate()").message).toMatch(/db.frobnicate\(\) is not supported/);
		expect(fail("").message).toMatch(/Nothing to run/);
	});

	test("errors point at the offending spot", () => {
		const e = fail("db.c.find({ status: paid })");
		expect(e.position).toBe(20);
	});
});

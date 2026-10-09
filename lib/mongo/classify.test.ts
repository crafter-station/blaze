import { describe, expect, test } from "bun:test";
import { classify } from "./classify";
import { parseShell } from "./shell";

const DB = "db_app_x7f2";
const of = (source: string) => classify(parseShell(source), DB);

describe("classify", () => {
	test("reads, writes and admin operations", () => {
		expect(of("db.c.find()")).toEqual({ label: "c.find", access: "read" });
		expect(of("db.c.aggregate([{ $match: {} }])").access).toBe("read");
		expect(of("db.c.aggregate([{ $out: 'copy' }])").access).toBe("write");
		expect(of("db.c.insertOne({ a: 1 })").access).toBe("write");
		expect(of("db.c.createIndex({ a: 1 })").access).toBe("admin");
		expect(of("show collections").access).toBe("read");
		expect(of("{ ping: 1 }")).toEqual({ label: "ping", access: "read" });
		expect(of("{ insert: 'c', documents: [{}] }").access).toBe("write");
	});

	test("asks before bulk deletes and updates with an empty filter", () => {
		expect(of("db.c.deleteMany({})").confirm?.message).toMatch(/every document in c/);
		expect(of("db.c.updateMany({}, { $set: { a: 1 } })").confirm?.message).toMatch(
			/every document/,
		);
		expect(of("db.c.deleteMany({ a: 1 })").confirm).toBeUndefined();
		expect(of("db.c.updateMany({ a: 1 }, { $set: { a: 2 } })").confirm).toBeUndefined();
		expect(of("{ delete: 'c', deletes: [{ q: {}, limit: 0 }] }").confirm).toBeTruthy();
		expect(of("{ delete: 'c', deletes: [{ q: {}, limit: 1 }] }").confirm).toBeUndefined();
	});

	test("asks before drop and dropIndex", () => {
		expect(of("db.c.drop()").confirm?.message).toMatch(/drops the collection c/);
		expect(of("db.c.drop()").confirm?.typeToConfirm).toBeUndefined();
		expect(of("db.c.dropIndex('a_1')").confirm?.message).toMatch(/a_1/);
		expect(of("{ drop: 'c' }").confirm).toBeTruthy();
	});

	test("dropDatabase requires typing the database name", () => {
		expect(of("db.dropDatabase()").confirm?.typeToConfirm).toBe(DB);
		expect(of("{ dropDatabase: 1 }").confirm?.typeToConfirm).toBe(DB);
	});

	test("blocks what needs a cursor or stream that outlives the request", () => {
		expect(of("db.c.watch()").blocked).toMatch(/change stream/);
		expect(of("db.c.find().tailable()").blocked).toMatch(/Tailable/);
		expect(of("{ getMore: 1, collection: 'c' }").blocked).toMatch(/getMore/);
		expect(of("{ find: 'c', tailable: true }").blocked).toBeTruthy();
		expect(
			of("{ aggregate: 'c', pipeline: [{ $changeStream: {} }], cursor: {} }").blocked,
		).toBeTruthy();
	});
});

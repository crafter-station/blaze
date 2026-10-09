import { describe, expect, test } from "bun:test";
import { collectionInStatement, complete } from "./completion";

const context = {
	collections: ["orders", "users", "odd-name"],
	fields: { orders: ["status", "total", "shipping.city"] },
};

const at = (source: string) => {
	const cursor = source.indexOf("|");
	const text = source.replace("|", "");
	return complete(text, cursor, context);
};
const labels = (source: string) => at(source)?.options.map((o) => o.label) ?? [];

describe("complete", () => {
	test("statement start offers db and show", () => {
		expect(labels("|")).toEqual(["db", "show collections", "show dbs"]);
		expect(labels("sh|")).toEqual(["show collections", "show dbs"]);
	});

	test("after db. offers collections and database methods", () => {
		const options = at("db.|")?.options ?? [];
		expect(options.slice(0, 3).map((o) => o.label)).toEqual(["orders", "users", "odd-name"]);
		expect(options.find((o) => o.label === "odd-name")?.apply).toBe('getCollection("odd-name")');
		expect(labels("db.or|")).toEqual(["orders"]);
		expect(labels("db.get|")).toContain("getCollectionNames");
		expect(at("db.or|")?.from).toBe(3);
	});

	test("after a collection offers its methods, with call syntax", () => {
		expect(labels("db.orders.fi|")).toEqual(["find", "findOne"]);
		const find = at("db.orders.|")?.options.find((o) => o.label === "find");
		expect(find?.apply).toBe("find(");
		expect(find?.detail).toMatch(/filter/);
		expect(labels('db.getCollection("x").ins|')).toEqual(["insertOne", "insertMany"]);
		expect(labels("db['odd-name'].dr|")).toEqual(["dropIndex", "drop"]);
	});

	test("after find(...) offers cursor methods; after aggregate only toArray/pretty", () => {
		expect(labels("db.orders.find({}).so|")).toEqual(["sort"]);
		expect(labels("db.orders.find({}).sort({ a: 1 }).l|")).toEqual(["limit"]);
		expect(labels("db.orders.aggregate([]).|")).toEqual(["toArray", "pretty"]);
	});

	test("query operators inside a filter", () => {
		expect(labels("db.orders.find({ total: { $g| } })")).toEqual([
			"$gt",
			"$gte",
			"$geoWithin",
			"$geoIntersects",
		]);
		expect(labels("db.orders.find({ $o|")).toContain("$or");
	});

	test("update operators in the update document of updateOne/updateMany", () => {
		expect(labels("db.orders.updateOne({ a: 1 }, { $s|")).toEqual([
			"$set",
			"$setOnInsert",
			"$slice",
			"$sort",
		]);
		// ...but query operators in their filter.
		expect(labels("db.orders.updateMany({ $o|")).toContain("$or");
	});

	test("pipeline stages at stage level, expressions inside a stage", () => {
		expect(labels("db.orders.aggregate([{ $ma|")).toEqual(["$match"]);
		expect(labels("db.orders.aggregate([{ $match: {} }, { $gr|")).toEqual([
			"$group",
			"$graphLookup",
		]);
		expect(labels("db.orders.aggregate([{ $group: { _id: null, n: { $su|")).toContain("$sum");
		expect(labels("db.orders.aggregate({ $li|")).toEqual(
			["$limit", "$literal"].filter((l) => l === "$limit"),
		);
	});

	test("field names from the sample at key position", () => {
		expect(labels("db.orders.find({ st|")).toEqual(["status"]);
		expect(at("db.orders.find({ sh|")?.options[0].apply).toBe('"shipping.city"');
		expect(at("db.users.find({ st|")).toBeNull();
	});

	test("nothing inside strings or at value position", () => {
		expect(at("db.orders.find({ status: 'pa|")).toBeNull();
		expect(at("db.orders.find({ status: pa|")).toBeNull();
	});
});

describe("collectionInStatement", () => {
	test("finds the collection in every addressing form", () => {
		expect(collectionInStatement("db.orders.find({")).toBe("orders");
		expect(collectionInStatement('db.getCollection("a b").find({')).toBe("a b");
		expect(collectionInStatement("db['x-y'].find({")).toBe("x-y");
		expect(collectionInStatement("db.getCollectionNames()")).toBeNull();
	});
});

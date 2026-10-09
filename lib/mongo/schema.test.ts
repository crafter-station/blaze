import { describe, expect, test } from "bun:test";
import type { EJsonValue } from "./literal";
import { describeShapes, inferShape, topLevelColumns } from "./schema";

const docs: EJsonValue[] = [
	{
		_id: { $oid: "6ac945381d3fd16de924a6a7" },
		email: "ada@example.com",
		age: 36,
		address: { city: "Lima", geo: { type: "Point", coordinates: [-77.04, -12.05] } },
		tags: ["vip", "beta"],
		items: [{ sku: "A", qty: 1 }],
		createdAt: { $date: "2026-01-01T00:00:00.000Z" },
	},
	{
		_id: { $oid: "6ac945381d3fd16de924a6a8" },
		email: null,
		age: 4.5,
		price: { $numberDecimal: "9.99" },
	},
];

describe("inferShape", () => {
	test("paths and BSON types, never values", () => {
		const shape = inferShape("users", docs);
		const byPath = Object.fromEntries(shape.fields.map((f) => [f.path, f]));
		expect(byPath._id.types).toEqual(["objectId"]);
		expect(byPath.email.types).toEqual(["string", "null"]);
		expect(byPath.age.types).toEqual(["int", "double"]);
		expect(byPath["address.city"].types).toEqual(["string"]);
		expect(byPath["address.geo.coordinates"].types).toEqual(["array<double>"]);
		expect(byPath.tags.types).toEqual(["array<string>"]);
		expect(byPath["items.sku"].types).toEqual(["string"]);
		expect(byPath.createdAt.types).toEqual(["date"]);
		expect(byPath.price.seen).toBe(1);

		const text = describeShapes([shape]);
		expect(text).toContain("users (sampled 2 documents)");
		expect(text).toContain("price: decimal (in 1/2)");
		for (const secret of ["ada@example.com", "Lima", "vip", "9.99", "6ac945381d3fd16de924a6a7"]) {
			expect(text).not.toContain(secret);
		}
	});

	test("an empty collection says so", () => {
		expect(describeShapes([inferShape("empty", [])])).toContain("(empty)");
	});
});

describe("topLevelColumns", () => {
	test("_id first, then first-seen order across documents", () => {
		expect(
			topLevelColumns([
				{ b: 1, _id: 1 },
				{ a: 1, b: 2 },
			]),
		).toEqual(["_id", "b", "a"]);
	});
});

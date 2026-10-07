import { describe, expect, test } from "bun:test";
import { detectDestructive, isReadOnlyQuery } from "./destructive";

const kind = (sql: string, engine: Parameters<typeof detectDestructive>[1] = "postgres") =>
	detectDestructive(sql, engine)?.kind ?? null;

describe("detectDestructive", () => {
	test("DROP and TRUNCATE", () => {
		expect(detectDestructive("DROP TABLE orders", "postgres")).toEqual({
			kind: "drop",
			label: "DROP TABLE",
		});
		expect(kind("drop schema analytics cascade")).toBe("drop");
		expect(kind("TRUNCATE orders")).toBe("truncate");
		expect(kind("truncate table orders", "mysql")).toBe("truncate");
	});

	test("ALTER TABLE … DROP COLUMN", () => {
		expect(detectDestructive("alter table orders drop column total", "postgres")?.label).toBe(
			"ALTER … DROP COLUMN",
		);
		expect(kind("alter table orders add column note text")).toBeNull();
	});

	test("DELETE / UPDATE without WHERE", () => {
		expect(kind("DELETE FROM orders")).toBe("delete-all");
		expect(kind("delete from orders where id = 1")).toBeNull();
		expect(kind("UPDATE orders SET status = 'x'")).toBe("update-all");
		expect(kind("update orders set status = 'x' where id = 1")).toBeNull();
		expect(kind("DELETE FROM orders USING customers", "postgres")).toBe("delete-all");
	});

	test("a WHERE inside a subquery does not count", () => {
		expect(kind("update orders set total = (select 1 from t where t.id = 2)")).toBe("update-all");
		expect(kind("delete from orders where id in (select id from t)")).toBeNull();
	});

	test("keywords in strings and comments are ignored", () => {
		expect(kind("select 'drop table orders'")).toBeNull();
		expect(kind("-- delete from orders\nselect 1")).toBeNull();
		expect(kind("delete from orders /* where id = 1 */")).toBe("delete-all");
		expect(kind("delete from orders -- where id = 1")).toBe("delete-all");
	});

	test("clause uses of UPDATE / DELETE are not statements", () => {
		expect(kind("select * from orders for update")).toBeNull();
		expect(
			kind("insert into t (id) values (1) on conflict (id) do update set id = excluded.id"),
		).toBeNull();
		expect(
			kind("insert into t (id) values (1) on duplicate key update id = 1", "mysql"),
		).toBeNull();
		expect(kind("create table t (a int references u (id) on delete cascade)")).toBeNull();
		expect(kind("grant select, update on orders to someone")).toBeNull();
	});

	test("routine definitions are not flagged", () => {
		expect(
			kind("create trigger t after insert on orders begin delete from log; end", "libsql"),
		).toBeNull();
	});

	test("data-modifying CTEs", () => {
		expect(kind("with gone as (delete from orders returning *) select count(*) from gone")).toBe(
			"delete-all",
		);
		expect(
			kind("with x as (select 1) delete from orders where id in (select * from x)"),
		).toBeNull();
		expect(kind("with x as (select 1) update orders set a = 1")).toBe("update-all");
	});

	test("ordinary statements", () => {
		expect(kind("select * from orders")).toBeNull();
		expect(kind("insert into orders (id) values (1)")).toBeNull();
		expect(kind("")).toBeNull();
	});
});

describe("isReadOnlyQuery", () => {
	test("plain reads", () => {
		expect(isReadOnlyQuery("select * from orders", "postgres")).toBe(true);
		expect(isReadOnlyQuery("with x as (select 1) select * from x", "postgres")).toBe(true);
		expect(isReadOnlyQuery("select * from orders for update", "postgres")).toBe(true);
		expect(isReadOnlyQuery("show tables", "mysql")).toBe(true);
	});

	test("anything that writes", () => {
		expect(isReadOnlyQuery("update orders set a = 1 where id = 1", "postgres")).toBe(false);
		expect(
			isReadOnlyQuery("with d as (delete from t returning *) select * from d", "postgres"),
		).toBe(false);
		expect(isReadOnlyQuery("select * into backup from orders", "postgres")).toBe(false);
		expect(isReadOnlyQuery("create table t (a int)", "postgres")).toBe(false);
		expect(isReadOnlyQuery("", "postgres")).toBe(false);
	});
});

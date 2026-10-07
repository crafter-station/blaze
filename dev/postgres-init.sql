-- Runs once, as the superuser, when the dev Postgres volume is first created.
-- Mirrors what lib/provision/postgres.ts does for a real tenant: a login role that owns
-- exactly one database and nothing else. Tables are created by `bun run dev:seed`,
-- connected as this role, so ownership matches production.

CREATE ROLE u_shop_dev LOGIN PASSWORD 'devpassword-shop' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE db_shop_dev OWNER u_shop_dev;
REVOKE ALL ON DATABASE db_shop_dev FROM PUBLIC;

\connect db_shop_dev
ALTER SCHEMA public OWNER TO u_shop_dev;

import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./lib/control/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		// biome-ignore lint/style/noNonNullAssertion: drizzle-kit runs from the CLI, outside lib/env
		url: process.env.DATABASE_URL!,
	},
	casing: "snake_case",
	verbose: true,
	strict: true,
});

import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineDocs } from "fumadocs-mdx/macro";

/**
 * The /docs content source. MDX lives in content/docs; meta.json files there define the
 * sidebar sections and order.
 */
const docs = defineDocs({
	dir: "content/docs",
	docs: {
		schema: pageSchema,
		// Vesper is near-monochrome with an amber accent, which is our palette already;
		// min-light is its quiet counterpart for light mode.
		mdxOptions: applyMdxPreset({
			rehypeCodeOptions: { themes: { light: "min-light", dark: "vesper" } },
		}),
	},
	meta: { schema: metaSchema },
});

export const source = loader({
	baseUrl: "/docs",
	source: docs.toFumadocsSource(),
	plugins: [lucideIconsPlugin()],
});

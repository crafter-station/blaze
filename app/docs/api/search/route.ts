import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

/**
 * Full-text index for the docs' search dialog (Cmd/Ctrl+K). Lives under /docs so it is
 * public through the existing `/docs(.*)` rule in proxy.ts rather than needing a new one.
 */
export const { GET } = createFromSource(source);

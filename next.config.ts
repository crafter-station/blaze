import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Dokploy deploys this as a container; standalone keeps the image small.
	output: "standalone",
	serverExternalPackages: ["pg", "mysql2", "mongodb", "ioredis"],
};

// Compiles content/docs/*.mdx for the Fumadocs-powered /docs.
const withMDX = createMDX();

export default withMDX(nextConfig);

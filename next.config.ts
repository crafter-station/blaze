import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Dokploy deploys this as a container; standalone keeps the image small.
	output: "standalone",
	serverExternalPackages: ["pg", "mysql2", "mongodb", "ioredis"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@areaforge/core", "@areaforge/ui"],
};

export default nextConfig;

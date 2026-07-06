import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@areaforge/ai",
    "@areaforge/config",
    "@areaforge/core",
    "@areaforge/db",
    "@areaforge/storage",
    "@areaforge/ui",
  ],
};

export default nextConfig;

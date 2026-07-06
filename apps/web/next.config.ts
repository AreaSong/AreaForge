import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  transpilePackages: [
    "@areaforge/ai",
    "@areaforge/auth",
    "@areaforge/config",
    "@areaforge/core",
    "@areaforge/db",
    "@areaforge/storage",
    "@areaforge/ui",
  ],
};

export default nextConfig;

import type { NextConfig } from "next";
import { createDevelopmentRuntimeIdentity } from "./lib/system/runtime-identity-development";

const developmentRuntimeIdentity = process.env.NODE_ENV === "development"
  ? JSON.stringify(createDevelopmentRuntimeIdentity())
  : null;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  ...(developmentRuntimeIdentity ? {
    env: {
      AREAFORGE_DEVELOPMENT_RUNTIME_IDENTITY_JSON: developmentRuntimeIdentity,
    },
  } : {}),
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

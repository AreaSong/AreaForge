import { parseServerEnv } from "@areaforge/config";

export function getAuthEnv() {
  return parseServerEnv(process.env);
}

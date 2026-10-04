import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { parseOperationContext, type OperationExecutionContext } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";

/** Web 只能读这一份脱敏投影；执行日志、配置、密钥与命令入口不进入 Web。 */
export async function readOperationExecutionContext(): Promise<OperationExecutionContext | null> {
  if (process.env.OPS_EXECUTION_ENABLED !== "true") return null;
  const file = process.env.OPS_EXECUTION_CONTEXT_FILE;
  if (!file) throw new ApiError("CONTROLLED_OPERATION_CONTEXT_UNAVAILABLE", 409);
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 16_384 || (stat.mode & 0o022)) throw new Error("unsafe context");
      const context = parseOperationContext(JSON.parse(await handle.readFile("utf8")));
      if (!context || context.scopeId !== process.env.OPS_EXECUTION_SCOPE_ID) throw new Error("invalid scope");
      if (context.environment === "production" ? stat.uid !== 0 : process.env.OPS_EXECUTION_LOCAL_FIXTURE !== "true" || stat.uid !== process.getuid?.()) throw new Error("invalid owner");
      const age = Date.now() - Date.parse(context.observedAt);
      if (age < -30_000 || age > 300_000) throw new Error("stale context");
      return context;
    } finally { await handle.close(); }
  } catch { throw new ApiError("CONTROLLED_OPERATION_CONTEXT_UNAVAILABLE", 409); }
}

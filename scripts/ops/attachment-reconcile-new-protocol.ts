import { reconcileNewProtocolAttachments } from "../../apps/web/lib/study/attachment-reconciliation-service";
import { prisma } from "../../packages/db/src/index";

/**
 * OPS-007 显式维护命令：对新协议（protocolVersion>=1）的 PENDING 附件执行
 * 有界 claim/lease reconciliation。只处理新协议记录，不触碰历史 orphan，
 * 不删除任何文件；输出为 redacted 计数摘要。
 */

function parseArgs(args: string[]): { limit?: number; minIntentAgeMs?: number; leaseMs?: number } {
  const options: { limit?: number; minIntentAgeMs?: number; leaseMs?: number } = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = Number.parseInt(args[index + 1] ?? "", 10);
    if (!Number.isFinite(value) || value <= 0) {
      console.error(`invalid value for ${key}`);
      process.exit(2);
    }
    if (key === "--limit") options.limit = value;
    else if (key === "--min-intent-age-minutes") options.minIntentAgeMs = value * 60_000;
    else if (key === "--lease-minutes") options.leaseMs = value * 60_000;
    else {
      console.error(`unknown argument ${key}`);
      console.error("Usage: pnpm attachment:reconcile:new-protocol [--limit N] [--min-intent-age-minutes N] [--lease-minutes N]");
      process.exit(2);
    }
  }
  return options;
}

try {
  const summary = await reconcileNewProtocolAttachments(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.counts.blockedDualFileCount > 0) {
    console.error("attachment reconciliation found ambiguous dual-file intents; manual review required.");
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}

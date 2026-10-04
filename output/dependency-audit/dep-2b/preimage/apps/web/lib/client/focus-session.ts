import { formatClockDuration } from "@/lib/formatters";

export function formatFocusElapsed(totalSeconds: number): string {
  return formatClockDuration(totalSeconds);
}

export function focusRequestErrorMessage(error: unknown, fallback: string): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "网络不可用，草稿与当前状态已保留。恢复网络后请显式重试。";
  }
  if (error instanceof TypeError) {
    return "请求未送达，草稿与当前状态已保留。请检查网络后显式重试。";
  }
  return error instanceof Error ? error.message : fallback;
}

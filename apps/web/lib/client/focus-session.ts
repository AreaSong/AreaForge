export function formatFocusElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
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

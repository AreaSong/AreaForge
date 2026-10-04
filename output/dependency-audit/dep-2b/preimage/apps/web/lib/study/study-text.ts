export function normalizeOptionalText(value: string | undefined, maxLength = 4000): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

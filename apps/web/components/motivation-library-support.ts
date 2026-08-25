import type { MotivationItemDto, MotivationVaultDto, MotivationVaultField } from "@/lib/contracts";

export type MotivationType = MotivationItemDto["type"];

export interface MotivationLibraryDraft {
  type: MotivationType;
  title: string;
  body: string;
  externalUrl: string;
  vaultField: MotivationVaultField | "";
  tags: string;
}

export const emptyDraft: MotivationLibraryDraft = {
  type: "QUOTE",
  title: "",
  body: "",
  externalUrl: "",
  vaultField: "",
  tags: "",
};

export const typeLabels: Record<MotivationType, string> = {
  QUOTE: "语录",
  VIDEO_LINK: "HTTPS 视频链接",
  VAULT_EXCERPT: "动机封存摘录",
};

const vaultFieldLabels: Record<MotivationVaultField, string> = {
  whyStarted: "为什么开始",
  neverReturnTo: "不想回去的状态",
  futureSelf: "未来的自己",
  messageToFuture: "给未来的话",
  firstSimulationDiary: "首次模考日记",
};

export function motivationVaultOptions(
  vault: MotivationVaultDto | null,
): Array<{ field: MotivationVaultField; label: string; text: string }> {
  if (!vault) return [];
  return (Object.keys(vaultFieldLabels) as MotivationVaultField[]).flatMap((field) => {
    const text = vault[field]?.trim();
    return text ? [{ field, label: vaultFieldLabels[field], text }] : [];
  });
}

export function parseTags(value: string): string[] {
  return [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
}

export function compareItems(left: MotivationItemDto, right: MotivationItemDto): number {
  return left.sortOrder - right.sortOrder || right.updatedAt.localeCompare(left.updatedAt);
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isEmptyDraft(draft: MotivationLibraryDraft): boolean {
  return !draft.title && !draft.body && !draft.externalUrl && !draft.vaultField && !draft.tags && draft.type === "QUOTE";
}

export function isMotivationLibraryDraft(value: unknown): value is MotivationLibraryDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<MotivationLibraryDraft>;
  return ["QUOTE", "VIDEO_LINK", "VAULT_EXCERPT"].includes(draft.type ?? "")
    && [draft.title, draft.body, draft.externalUrl, draft.tags].every((entry) => typeof entry === "string")
    && (draft.vaultField === "" || Object.hasOwn(vaultFieldLabels, draft.vaultField ?? ""));
}

export function isMotivationItem(value: unknown): value is MotivationItemDto {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MotivationItemDto>;
  return typeof item.id === "string" && typeof item.title === "string" && Number.isInteger(item.revision);
}

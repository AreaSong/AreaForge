export type PlanInboxItemStatus = "OPEN" | "DISMISSED" | "CONVERTED";

export function canDismissInboxItem(input: {
  status: PlanInboxItemStatus;
  supersededByItemId: string | null;
}): "ok" | "already_converted" | "superseded" | "already_dismissed" {
  if (input.supersededByItemId) return "superseded";
  if (input.status === "CONVERTED") return "already_converted";
  if (input.status === "DISMISSED") return "already_dismissed";
  return "ok";
}

export function canReopenInboxItem(input: {
  status: PlanInboxItemStatus;
  supersededByItemId: string | null;
}): "ok" | "superseded" | "not_dismissed" | "converted" {
  if (input.supersededByItemId) return "superseded";
  if (input.status === "CONVERTED") return "converted";
  if (input.status !== "DISMISSED") return "not_dismissed";
  return "ok";
}

export function canConvertInboxItem(input: {
  status: PlanInboxItemStatus;
  supersededByItemId: string | null;
  originArchived: boolean;
}): "ok" | "superseded" | "not_open" | "origin_archived" {
  if (input.supersededByItemId) return "superseded";
  if (input.status !== "OPEN") return "not_open";
  if (input.originArchived) return "origin_archived";
  return "ok";
}

export function buildOriginIdentity(input: {
  originKey: string;
  originVersion: number;
}): { originKey: string; originVersion: number } {
  return {
    originKey: input.originKey.trim(),
    originVersion: input.originVersion,
  };
}

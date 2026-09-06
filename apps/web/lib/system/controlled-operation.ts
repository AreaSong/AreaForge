import { z } from "zod";

/**
 * 运维中心的第一层协议只描述“想做什么”，不携带命令、路径或环境变量。
 * 真正执行仍然必须由 root-only agent 按白名单和独立确认包处理。
 */
export const controlledOperationCodes = [
  "CHECK_RELEASE",
  "BACKUP_PREVIEW",
  "APPLY_RELEASE",
  "ROLLBACK_RELEASE",
  "MAINTENANCE_HOLD",
  "DIAGNOSTIC_HEALTH",
] as const;

export type ControlledOperationCode = typeof controlledOperationCodes[number];

export type ControlledOperationRisk = "READ_ONLY" | "HIGH_RISK";

export interface ControlledOperationDescriptor {
  code: ControlledOperationCode;
  label: string;
  risk: ControlledOperationRisk;
  requiresApproval: boolean;
  requiresExpectedBefore: boolean;
  executionOwner: "WEB_PREVIEW" | "ROOT_AGENT";
}
const operationDescriptorList: readonly ControlledOperationDescriptor[] = [
  {
    code: "CHECK_RELEASE",
    label: "检查已验证 Release",
    risk: "READ_ONLY",
    requiresApproval: false,
    requiresExpectedBefore: true,
    executionOwner: "ROOT_AGENT",
  },
  {
    code: "BACKUP_PREVIEW",
    label: "预览备份计划",
    risk: "READ_ONLY",
    requiresApproval: false,
    requiresExpectedBefore: true,
    executionOwner: "ROOT_AGENT",
  },
  {
    code: "APPLY_RELEASE",
    label: "应用已验证 Release",
    risk: "HIGH_RISK",
    requiresApproval: true,
    requiresExpectedBefore: true,
    executionOwner: "ROOT_AGENT",
  },
  {
    code: "ROLLBACK_RELEASE",
    label: "回滚到固定目标",
    risk: "HIGH_RISK",
    requiresApproval: true,
    requiresExpectedBefore: true,
    executionOwner: "ROOT_AGENT",
  },
  {
    code: "MAINTENANCE_HOLD",
    label: "进入维护屏障",
    risk: "HIGH_RISK",
    requiresApproval: true,
    requiresExpectedBefore: true,
    executionOwner: "ROOT_AGENT",
  },
  {
    code: "DIAGNOSTIC_HEALTH",
    label: "读取脱敏健康摘要",
    risk: "READ_ONLY",
    requiresApproval: false,
    requiresExpectedBefore: true,
    executionOwner: "ROOT_AGENT",
  },
] as const;

const idempotencyKeySchema = z.string().uuid();
const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const operationParametersSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("CHECK_RELEASE"), tag: z.string().regex(/^v?\d+\.\d+\.\d+$/).nullable() }).strict(),
  z.object({ operation: z.literal("BACKUP_PREVIEW"), scope: z.enum(["DATABASE", "UPLOADS", "FULL"]) }).strict(),
  z.object({ operation: z.literal("APPLY_RELEASE"), tag: z.string().regex(/^v?\d+\.\d+\.\d+$/) }).strict(),
  z.object({ operation: z.literal("ROLLBACK_RELEASE"), targetVersion: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict(),
  z.object({ operation: z.literal("MAINTENANCE_HOLD"), reasonCode: z.enum(["RELEASE", "INCIDENT", "RESTORE", "CAPACITY"]) }).strict(),
  z.object({ operation: z.literal("DIAGNOSTIC_HEALTH"), includeCapacity: z.boolean() }).strict(),
]);

export const controlledOperationIntentSchema = z.object({
  operation: operationParametersSchema,
  expectedBeforeHash: hashSchema,
  idempotencyKey: idempotencyKeySchema,
  requestedReason: z.string().trim().min(1).max(240),
}).strict();

export type ControlledOperationIntent = z.infer<typeof controlledOperationIntentSchema>;

export function listControlledOperations(): ControlledOperationDescriptor[] {
  return operationDescriptorList.map((operation) => ({ ...operation }));
}

export function getControlledOperationDescriptor(
  operation: ControlledOperationCode,
): ControlledOperationDescriptor {
  const descriptor = operationDescriptorList.find((item) => item.code === operation);
  if (!descriptor) throw new Error(`UNKNOWN_CONTROLLED_OPERATION:${operation}`);
  return { ...descriptor };
}

export function parseControlledOperationIntent(raw: unknown): ControlledOperationIntent | null {
  const parsed = controlledOperationIntentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function isControlledOperationCode(value: unknown): value is ControlledOperationCode {
  return typeof value === "string" && controlledOperationCodes.includes(value as ControlledOperationCode);
}

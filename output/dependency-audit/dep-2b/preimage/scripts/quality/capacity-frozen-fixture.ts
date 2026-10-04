import { randomUUID } from "node:crypto";
import { hashDataExportValue } from "../../packages/core/src/index";
import { controlDatabaseDeletion, type DeleteActor, type PrismaClient } from "../../packages/db/src/index";
import { CAPACITY_SCHEMA_SHA256 } from "./capacity-fixture";

/** 合成冻结状态只用于验证计量与可见性差别，不声明删除清单已获授权或可执行。 */
export async function withCapacityFrozenRows<T>(client: PrismaClient, actor: DeleteActor,
  rows: Array<{ model: "DataJob" | "WorkspaceMembership"; id: string }>, run: () => Promise<T>): Promise<T> {
  const fingerprint = hashDataExportValue({ fixture: "capacity-visibility-only", nonce: randomUUID() });
  const frozenAt = new Date();
  const intent = await client.dataDeletionIntent.create({ data: { requesterId: actor.id, scope: "ACCOUNT", state: "COOLDOWN",
    idempotencyKey: randomUUID(), requestHash: fingerprint, fingerprint, authorizationHash: fingerprint, schemaHash: CAPACITY_SCHEMA_SHA256,
    frozenAt, availableAt: new Date(frozenAt.getTime() + 86_400_000), receiptTokenHash: fingerprint.replace(/^sha256:/, ""),
    receiptExpiresAt: new Date(frozenAt.getTime() + 90_000_000) } });
  const values = rows.map(row => ({ intentId: intent.id, model: row.model, keyJson: { id: row.id },
    identityHash: hashDataExportValue({ model: row.model, key: { id: row.id } }) }));
  try {
    await client.$transaction(async tx => {
      await tx.dataDeletionItem.createMany({ data: values.map(value => ({ ...value, rowHash: fingerprint })) });
      await tx.dataDeletionFence.createMany({ data: values });
    });
    return await run();
  } finally {
    await controlDatabaseDeletion(client, { actor, intentId: intent.id, expectedRevision: intent.revision, action: "cancel" });
  }
}

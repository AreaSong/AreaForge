import type { DataJobKind } from "@areaforge/core";
import type { Prisma, PrismaClient } from "../generated/prisma/client";

export type DataQueueClient = PrismaClient;
export type DataQueueTransaction = Prisma.TransactionClient;
export type QueuedDataJob = Awaited<ReturnType<DataQueueTransaction["dataJob"]["findUniqueOrThrow"]>>;

export interface DataJobPartition {
  requestedByUserId?: string;
  workspaceId?: string | null;
}

export interface DataJobLease {
  jobId: string;
  kind: DataJobKind;
  scope: "ACCOUNT" | "WORKSPACE";
  requestedByUserId: string;
  workspaceId: string | null;
  workerId: string;
  leaseVersion: number;
  attempt: number;
  leaseExpiresAt: Date;
}

export interface EnqueueDataJobInput {
  kind: DataJobKind;
  scope: DataJobLease["scope"];
  requestedByUserId: string;
  workspaceId: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  expiresAt: Date;
  maxAttempts?: number;
}

export interface ClaimDataJobInput {
  workerId: string;
  kinds: readonly DataJobKind[];
  leaseMs: number;
  partition?: DataJobPartition;
}

export class DataJobQueueError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DataJobQueueError";
  }
}

"use client";

import { Archive, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  createLearningTreeArchiveCapability,
  learningTreeArchiveCapabilitySourceKey,
  reconcileLearningTreeArchiveCapability,
  resolveLearningTreeArchiveCapability,
} from "@/lib/client/learning-tree-archive-capability";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { LearningTreeImportBatchSummaryDto } from "@/lib/study/learning-tree-service";

const deniedArchiveCapabilities = new Set<string>();

export function LearningTreeBatchArchiveButton({
  batchId,
  archived,
  workspaceStatus,
  workspaceRevision,
}: {
  batchId: string;
  archived: boolean;
  workspaceStatus?: "ACTIVE" | "ARCHIVED";
  workspaceRevision?: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const capabilitySource = useMemo(
    () => ({ batchId, archived, workspaceStatus, workspaceRevision }),
    [archived, batchId, workspaceRevision, workspaceStatus],
  );
  const capabilitySourceKey = learningTreeArchiveCapabilitySourceKey(capabilitySource);
  const [capability, setCapability] = useState(() => createLearningTreeArchiveCapability(capabilitySource));
  const currentCapability = reconcileLearningTreeArchiveCapability(capability, capabilitySource);

  useEffect(() => {
    let active = true;

    async function resolveCapability(): Promise<boolean | null> {
      if (archiveCapabilityWasDenied(capabilitySourceKey)) return false;
      if (workspaceStatus) return workspaceStatus === "ACTIVE";

      try {
        const response = await fetch(`/api/learning-tree/imports/${batchId}`);
        if (response.status === 401) {
          redirectToLoginWithCurrentLocation();
          return null;
        }
        const body = (await response.json().catch(() => null)) as {
          import?: LearningTreeImportBatchSummaryDto;
        } | null;
        return response.ok ? body?.import?.workspaceStatus === "ACTIVE" : false;
      } catch {
        return false;
      }
    }

    void resolveCapability().then((allowed) => {
      if (active && allowed !== null) {
        setCapability((current) => resolveLearningTreeArchiveCapability(
          reconcileLearningTreeArchiveCapability(current, capabilitySource),
          allowed,
        ));
      }
    });
    return () => {
      active = false;
    };
  }, [batchId, capabilitySource, capabilitySourceKey, workspaceStatus]);

  async function update() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/learning-tree/imports/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
      });
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      if (response.ok) {
        router.refresh();
      } else if (response.status === 404 || response.status === 409) {
        rememberArchiveCapabilityDenial(capabilitySourceKey);
        setCapability((current) => resolveLearningTreeArchiveCapability(
          reconcileLearningTreeArchiveCapability(current, capabilitySource),
          false,
        ));
      } else {
        setError("归档状态更新失败，当前状态没有改变；请显式重试。");
      }
    } catch {
      setError("网络不可用，当前状态没有改变；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  if (currentCapability.allowed !== true) return null;
  const Icon = archived ? RotateCcw : Archive;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => void update()}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-xs text-zinc-200 disabled:opacity-50"
      >
        <Icon size={14} aria-hidden />
        {pending ? "处理中" : archived ? "恢复" : "归档"}
      </button>
      {error ? <p className="max-w-72 text-right text-xs text-red-300" role="alert">{error}</p> : null}
    </div>
  );
}

function archiveCapabilityWasDenied(sourceKey: string): boolean {
  if (deniedArchiveCapabilities.has(sourceKey)) return true;
  try {
    const denied = window.sessionStorage.getItem(archiveCapabilityStorageKey(sourceKey)) === "1";
    if (denied) deniedArchiveCapabilities.add(sourceKey);
    return denied;
  } catch {
    return false;
  }
}

function rememberArchiveCapabilityDenial(sourceKey: string): void {
  deniedArchiveCapabilities.add(sourceKey);
  try {
    window.sessionStorage.setItem(archiveCapabilityStorageKey(sourceKey), "1");
  } catch {
    // The in-memory fallback still prevents remount resurrection in this tab.
  }
}

function archiveCapabilityStorageKey(sourceKey: string): string {
  return `areaforge.learning-tree.archive-denied.${sourceKey}`;
}

export function LearningTreeImportHistory({
  title,
  imports,
  archived,
  returnTo = "/knowledge/imports",
}: {
  title: string;
  imports: LearningTreeImportBatchSummaryDto[];
  archived: boolean;
  returnTo?: string;
}) {
  return (
    <section className="space-y-3 border-t border-white/10 pt-6">
      <h2 className="text-lg font-medium text-white">{title}</h2>
      <ul className="divide-y divide-white/10 rounded-md border border-white/10">
        {imports.length ? imports.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div>
              <p className="text-zinc-100">{scopeLabel(item.scope)}导入</p>
              <p className="text-xs text-zinc-500">
                {item.itemCount} 项 · {new Date(item.confirmedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
              </p>
            </div>
            <div className="flex gap-2">
              <Link className="h-9 px-2 leading-9 text-teal-300 hover:underline" href={withReturnTo(`/knowledge/imports/${item.id}`, returnTo)}>
                查看结果
              </Link>
              <LearningTreeBatchArchiveButton
                batchId={item.id}
                archived={archived}
                workspaceStatus={item.workspaceStatus}
                workspaceRevision={item.workspaceRevision}
              />
            </div>
          </li>
        )) : (
          <li className="px-4 py-8 text-sm text-zinc-500">暂无导入记录。</li>
        )}
      </ul>
    </section>
  );
}

function scopeLabel(value: string): string {
  if (value === "global") return "全局";
  if (value === "subject") return "单科";
  if (value === "branch") return "分支";
  return "自定义范围";
}

"use client";

import { useEffect, useRef, useState } from "react";
import { isWorkspaceSearchResponse, searchWorkspaceApi } from "@/lib/api/search";
import { createLatestOperationGate } from "@/lib/client/operation-gates";
import type { WorkspaceSearchResultDto } from "@/lib/contracts";
import type { GlobalCommandDefinition } from "@/lib/navigation/command-palette";

export type WorkspaceSearchStatus = "idle" | "loading" | "ready" | "error";

interface SettledSearch {
  key: string;
  commands: GlobalCommandDefinition[];
  status: "ready" | "error";
}

const KIND_LABEL: Record<WorkspaceSearchResultDto["kind"], string> = {
  SUBJECT: "科目",
  TASK: "任务",
  KNOWLEDGE_POINT: "知识点",
  NOTE: "知识卡片",
  MISTAKE: "错题",
  RESOURCE: "资料",
};

const VISIBILITY_LABEL: Record<WorkspaceSearchResultDto["visibility"], string> = {
  WORKSPACE: "工作区可见",
  OWNER: "仅自己",
  SHARED: "已授权",
};

export function useWorkspaceSearchCommands(
  workspaceId: string | null | undefined,
  query: string,
  onResultsReady: () => void,
): {
  commands: GlobalCommandDefinition[];
  status: WorkspaceSearchStatus;
} {
  const gateRef = useRef(createLatestOperationGate());
  const [settled, setSettled] = useState<SettledSearch | null>(null);
  const activeWorkspaceId = typeof workspaceId === "string" && workspaceId ? workspaceId : null;
  const normalized = query.trim().replace(/\s+/g, " ");
  const enabled = Boolean(activeWorkspaceId) && normalized.length >= 2 && normalized.length <= 80
    && !normalized.startsWith("/") && !normalized.startsWith("$");
  const searchKey = `${activeWorkspaceId ?? ""}\u0000${normalized}`;

  useEffect(() => {
    const gate = gateRef.current;
    gate.invalidate();
    if (!enabled || !activeWorkspaceId) return;
    const timer = window.setTimeout(() => {
      const token = gate.begin();
      void searchWorkspaceApi(activeWorkspaceId, normalized).then((result) => {
        if (!gate.isCurrent(token)) return;
        const search = result.body?.search;
        if (!result.ok || !isWorkspaceSearchResponse(search) || search.workspaceId !== activeWorkspaceId || search.query !== normalized) {
          setSettled({ key: searchKey, commands: [], status: "error" });
          gate.finish(token);
          return;
        }
        setSettled({ key: searchKey, commands: search.results.map(toCommand), status: "ready" });
        onResultsReady();
        gate.finish(token);
      });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      gate.invalidate();
    };
  }, [activeWorkspaceId, enabled, normalized, onResultsReady, searchKey]);

  if (!enabled) return { commands: [], status: "idle" };
  if (!settled || settled.key !== searchKey) return { commands: [], status: "loading" };
  return { commands: settled.commands, status: settled.status };
}

function toCommand(result: WorkspaceSearchResultDto): GlobalCommandDefinition {
  return {
    id: `workspace-search:${result.kind}:${result.id}`,
    label: result.label,
    description: `${KIND_LABEL[result.kind]} · ${VISIBILITY_LABEL[result.visibility]}`,
    aliases: [result.label],
    href: result.href,
  };
}

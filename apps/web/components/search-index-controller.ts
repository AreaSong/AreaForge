"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceSearchJobView } from "@areaforge/core";
import { getSearchIndex, requestSearchIndex, controlSearchIndex, searchIndexAccessLost, searchIndexUncertain, type SearchIndexRequestIdentity } from "@/lib/api/search-index";
import type { SearchIndexStatus } from "@/lib/api/search-index-schema";
import { createExclusiveOperationGate, createLatestOperationGate } from "@/lib/client/operation-gates";
import { createSearchIndexIdentity } from "@/lib/client/search-index-request";
import { dataJobQuotaErrorText } from "@/lib/api/data-job-quota-errors";

/** 调用方用用户×工作区作为组件 key；卸载时两类在途操作同时作废。 */
export function useSearchIndex(workspaceId: string) {
  const [status, setStatus] = useState<SearchIndexStatus | null>(null);
  const [pending, setPending] = useState(false); const [retrySame, setRetrySame] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loads = useRef(createLatestOperationGate()); const mutations = useRef(createExclusiveOperationGate());
  const identity = useRef<SearchIndexRequestIdentity | null>(null);
  const refresh = useCallback(async () => {
    if (mutations.current.isLocked()) return;
    const token = loads.current.begin(); const result = await getSearchIndex(workspaceId);
    if (!loads.current.isCurrent(token)) return;
    if (result.ok && result.body?.searchIndex) { setStatus(result.body.searchIndex); setNotice(null); }
    else {
      setStatus(current => searchIndexAccessLost(result) ? null : current ? { ...current, index: null } : null);
      setNotice(searchIndexAccessLost(result) ? "当前身份或工作区权限已失效，请重新登录或切换工作区。" : "无法确认索引状态；可重试刷新，搜索不会使用未经验证的旧标题。");
      if (searchIndexAccessLost(result)) { identity.current = null; setRetrySame(false); }
    }
    loads.current.finish(token);
  }, [workspaceId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0); const read = loads.current; const write = mutations.current;
    return () => { window.clearTimeout(timer); read.invalidate(); write.invalidate(); };
  }, [refresh]);
  const active = status?.jobs.some(job => ["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED"].includes(job.status) || (job.status === "FAILED" && job.retryable)) ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer);
  }, [active, refresh]);

  const request = async () => {
    if (!status?.enabled) return;
    const token = mutations.current.acquire(); if (!token) return;
    loads.current.invalidate(); setPending(true); setNotice(null);
    identity.current ??= createSearchIndexIdentity(status.generation);
    const result = await requestSearchIndex(workspaceId, identity.current);
    if (!mutations.current.isActive(token)) return;
    if (result.ok && result.body?.job) {
      const job = result.body.job; identity.current = null; setRetrySame(false);
      setStatus(current => current ? { ...current, generation: Math.max(current.generation, job.generation),
        jobs: [job, ...current.jobs.filter(row => row.id !== job.id)].slice(0, 10) } : current);
      setNotice("索引重建已排队；搜索继续使用通过当前权限校验的结果。");
    } else if (searchIndexUncertain(result)) {
      setRetrySame(true); setNotice("回执尚未确认，请重试同一请求；不会重复创建索引任务。");
    } else {
      identity.current = null; setRetrySame(false); setNotice(searchIndexErrorText(result.body?.error));
      if (searchIndexAccessLost(result)) setStatus(null);
      if (result.body?.error === "SEARCH_INDEX_DISABLED") setStatus(current => current ? { ...current, enabled: false } : current);
    }
    mutations.current.release(token); setPending(false);
  };
  const control = async (job: WorkspaceSearchJobView, action: WorkspaceSearchJobView["controls"][number]) => {
    const token = mutations.current.acquire(); if (!token) return;
    loads.current.invalidate(); setPending(true); setNotice(null);
    const result = await controlSearchIndex(workspaceId, job, action);
    if (!mutations.current.isActive(token)) return;
    if (result.ok && result.body?.job) {
      setStatus(current => current ? { ...current, jobs: current.jobs.map(row => row.id === job.id ? result.body!.job! : row) } : current);
      setNotice("控制请求已记录；运行中的暂停或取消需等待执行器确认。");
    } else {
      setNotice(searchIndexErrorText(result.body?.error));
      if (searchIndexAccessLost(result)) { setStatus(null); identity.current = null; setRetrySame(false); }
    }
    mutations.current.release(token); setPending(false);
  };
  return { status, pending, notice, retrySame, active, refresh, request, control };
}

function searchIndexErrorText(code?: string): string {
  const quotaError = dataJobQuotaErrorText(code); if (quotaError) return quotaError;
  if (/SUPERSEDED|SNAPSHOT_CHANGED|GENERATION_CONFLICT/.test(code ?? "")) return "权限、来源或索引代次已变化；请刷新状态后重新申请，旧任务不会重绑权限。";
  if (/DISABLED/.test(code ?? "")) return "索引重建当前关闭；搜索仍可安全直查，已有任务可取消。";
  if (/LIMIT/.test(code ?? "")) return "本次索引超过安全容量，未发布部分结果；搜索继续使用安全直查。";
  if (/NOT_FOUND|SESSION_REVOKED|UNAUTHORIZED/.test(code ?? "")) return "当前身份或工作区权限已失效，请重新登录或切换工作区。";
  return "请求未完成，请刷新后重试；不会修改学习源数据。";
}

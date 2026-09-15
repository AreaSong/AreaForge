"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RankingRebuildJobView } from "@areaforge/core";
import { getChallengeProjection } from "@/lib/api/ranking";
import { controlRankingRebuild, listRankingRebuildJobs, rankingRebuildAccessLost, rankingRebuildResponseUncertain,
  requestRankingRebuild, type RankingRebuildIdentity } from "@/lib/api/ranking-rebuild";
import { createExclusiveOperationGate, createLatestOperationGate } from "@/lib/client/operation-gates";
import { createRankingRebuildIdentity } from "@/lib/client/ranking-rebuild-request";
import type { RankingProjectionViewDto } from "@/lib/ranking/contracts";

export function useRankingRebuild(input: { challengeId: string; actorId: string; revision: number; canManage: boolean }) {
  const scopeKey = `${input.challengeId}:${input.actorId}:${input.canManage}`;
  const [loadedScope, setLoadedScope] = useState(scopeKey);
  const [jobs, setJobs] = useState<RankingRebuildJobView[]>([]);
  const [projection, setProjection] = useState<{ value: RankingProjectionViewDto; scope: string; revision: number } | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [retrySame, setRetrySame] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const identity = useRef<RankingRebuildIdentity | null>(null);
  const mutationGate = useRef(createExclusiveOperationGate());
  const loadGate = useRef(createLatestOperationGate());

  const refresh = useCallback(async () => {
    if (mutationGate.current.isLocked()) return;
    const token = loadGate.current.begin();
    const [rank, tasks] = await Promise.all([getChallengeProjection(input.challengeId),
      input.canManage ? listRankingRebuildJobs(input.challengeId) : Promise.resolve(null)]);
    if (!loadGate.current.isCurrent(token)) return;
    setProjection(rank.ok && rank.body?.projection ? { value: rank.body.projection, scope: scopeKey, revision: input.revision } : null);
    if (tasks?.ok) { setJobs(tasks.body?.jobs ?? []); setEnabled(tasks.body?.enabled === true); }
    else if (tasks && rankingRebuildAccessLost(tasks)) { setJobs([]); setEnabled(null); }
    if (rankingRebuildAccessLost(rank)) { setJobs([]); setEnabled(null); }
    if (!rank.ok || (tasks && !tasks.ok)) setNotice("暂时无法刷新排名；旧分数已隐藏，已有任务控制保留，请重试刷新。");
    else setNotice(null);
  }, [input.challengeId, input.canManage, input.revision, scopeKey]);

  useEffect(() => {
    identity.current = null;
    const timer = window.setTimeout(() => { setJobs([]); setProjection(null); setRetrySame(false); setEnabled(null);
      setPending(false); setNotice(null); setLoadedScope(scopeKey); }, 0);
    const mutations = mutationGate.current; const loads = loadGate.current;
    return () => { window.clearTimeout(timer); mutations.invalidate(); loads.invalidate(); };
  }, [scopeKey]);

  useEffect(() => {
    const gate = loadGate.current;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(timer); gate.invalidate(); };
  }, [refresh]);

  const request = async () => {
    if (!input.canManage || !enabled) return;
    const token = mutationGate.current.acquire(); if (!token) return;
    loadGate.current.invalidate();
    identity.current ??= createRankingRebuildIdentity(input.revision);
    setPending(true); setNotice(null);
    const result = await requestRankingRebuild(input.challengeId, identity.current);
    if (!mutationGate.current.isActive(token)) return;
    if (result.ok && result.body?.job) {
      identity.current = null; setRetrySame(false);
      setJobs(current => [result.body!.job!, ...current.filter(row => row.id !== result.body!.job!.id)].slice(0, 10));
      setNotice("重建请求已持久保存；进度与结果由独立执行器提交。");
    } else if (rankingRebuildResponseUncertain(result)) {
      setRetrySame(true); setNotice("响应未确认，请重试同一请求；不会更换幂等键或重复申请。");
    } else {
      identity.current = null; setRetrySame(false); setNotice(rankingRebuildErrorText(result.body?.error));
      if (rankingRebuildAccessLost(result)) { setProjection(null); setJobs([]); setEnabled(null); }
      if (result.body?.error === "RANKING_REBUILD_DISABLED") setEnabled(false);
    }
    mutationGate.current.release(token); setPending(false);
  };

  const control = async (job: RankingRebuildJobView, action: RankingRebuildJobView["controls"][number]) => {
    const token = mutationGate.current.acquire(); if (!token) return;
    loadGate.current.invalidate();
    setPending(true); setNotice(null);
    const result = await controlRankingRebuild(input.challengeId, job, action);
    if (!mutationGate.current.isActive(token)) return;
    if (result.ok && result.body?.job) {
      setJobs(current => current.map(row => row.id === job.id ? result.body!.job! : row));
      setNotice("控制请求已记录；运行中的停止请求需等待执行器确认。");
    } else {
      setNotice(rankingRebuildErrorText(result.body?.error));
      if (rankingRebuildAccessLost(result)) { setProjection(null); setJobs([]); setEnabled(null); identity.current = null; setRetrySame(false); }
    }
    mutationGate.current.release(token); setPending(false);
    if (!rankingRebuildAccessLost(result)) await refresh();
  };

  const currentScope = loadedScope === scopeKey;
  return { jobs: currentScope ? jobs : [], projection: projection?.scope === scopeKey && projection.revision === input.revision ? projection.value : null,
    enabled: currentScope && enabled === true, disabled: currentScope && enabled === false,
    pending: currentScope && pending, retrySame: currentScope && retrySame, notice: currentScope ? notice : null, refresh, request, control };
}

export function rankingRebuildErrorText(code?: string): string {
  if (/SUPERSEDED|SNAPSHOT_CHANGED/.test(code ?? "")) return "原任务的权限或来源已变化，请刷新挑战后重新申请；旧任务不会重绑新权限。";
  if (/DISABLED/.test(code ?? "")) return "后台重建当前关闭；已保存任务不会转回同步执行。";
  if (/NOT_FOUND|SESSION_REVOKED|UNAUTHORIZED/.test(code ?? "")) return "当前身份或挑战权限已失效，请重新登录或刷新工作区。";
  return "请求未完成，请刷新状态后重试；学习源事实保持不变。";
}

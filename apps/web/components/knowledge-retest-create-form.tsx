"use client";

import { createKnowledgeRetest } from "@/lib/api/knowledge-retest";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { sanitizeReturnPath, withReturnTo } from "@/lib/navigation/app-navigation";
import type { KnowledgePointDto, KnowledgeRetestDetailDto } from "@/lib/contracts";
import { masteryStatusLabel } from "@/lib/knowledge/mastery-status";

interface RetestCreatePayload {
  title: string;
  method: string;
  knowledgePointIds: string[];
}

interface RetestCreateConflict {
  payload: RetestCreatePayload;
  latest: KnowledgeRetestDetailDto | null;
  conflictFields: string[];
}

export function KnowledgeRetestCreateForm({ points, returnTo = "/test/retests" }: { points: KnowledgePointDto[]; returnTo?: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("专项复测");
  const [method, setMethod] = useState("主动回忆 + 讲解");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<RetestCreateConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(pointId: string) {
    setSelected((current) => current.includes(pointId) ? current.filter((id) => id !== pointId) : [...current, pointId]);
  }

  function submit() {
    if (!selected.length) {
      setError("至少选择一个知识点。");
      return;
    }
    setError(null);
    startTransition(async () => {
      const payload: RetestCreatePayload = { title, method, knowledgePointIds: [...selected] };
      try {
        const response = await createKnowledgeRetest({
          idempotencyKey: getOrCreateIdempotencyKey("knowledge-retest:create", "knowledge-retest", payload),
          ...payload,
        });
        const body = response.body;
        if (isUnauthorized(response)) {
          setError("登录已过期，复测表单仍保留；重新登录后请显式重试。");
          redirectToLoginWithCurrentLocation();
          return;
        }
        if (!response.ok || !body?.retest?.id) {
          if (isConflict(response)) {
            const latest = isKnowledgeRetestDetail(body?.latest) ? body.latest : null;
            setConflict({
              payload,
              latest,
              conflictFields: body?.conflictFields ?? ["idempotencyKey", "requestFingerprint"],
            });
            setConflictOpen(true);
          }
          setError(body?.error ?? "无法安排复测，表单输入仍保留；请处理冲突后重试。");
          return;
        }
        router.push(withReturnTo(`/test/retests/${body.retest.id}`, sanitizeReturnPath(returnTo)));
      } catch {
        setError("网络不可用，复测表单仍保留；恢复网络后请显式重试。");
      }
    });
  }

  function adoptServerVersion() {
    if (!conflict) return;
    setConflictOpen(false);
    setConflict(null);
    if (conflict.latest?.id) {
      router.push(withReturnTo(`/test/retests/${conflict.latest.id}`, sanitizeReturnPath(returnTo)));
      return;
    }
    setError("服务端没有可采用的复测版本，请刷新后确认当前状态。");
    router.refresh();
  }

  function prepareRetry() {
    setConflictOpen(false);
    setConflict(null);
    setError("本地复测输入已保留，请检查后再次点击“安排并开始复测”；系统不会自动重放。");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <Link href={returnTo} className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"><ArrowLeft size={16} aria-hidden="true" />返回专项复测</Link>
        <span className="inline-flex items-center gap-2 text-xs text-zinc-500"><ClipboardCheck size={15} aria-hidden="true" />{selected.length} 个知识点</span>
      </div>
      <div className="af-content-grid-two grid gap-4">
        <Field label="复测名称" htmlFor="knowledge-retest-title">
          <Input id="knowledge-retest-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="h-11 bg-[var(--af-surface-raised)] text-white" />
        </Field>
        <Field label="复测方法" htmlFor="knowledge-retest-method">
          <Select id="knowledge-retest-method" value={method} onChange={(event) => setMethod(event.target.value)} className="h-11 bg-[var(--af-surface-raised)] text-white">
            <option>主动回忆 + 讲解</option>
            <option>基础题</option>
            <option>变式应用</option>
            <option>限时综合应用</option>
          </Select>
        </Field>
      </div>
      <div>
        <p className="text-sm font-medium text-white">选择知识点</p>
        <div className="mt-3 divide-y divide-white/10 border-y border-white/10">
          {points.map((point) => (
            <label key={point.id} className="flex cursor-pointer items-start gap-3 py-3">
              <Checkbox checked={selected.includes(point.id)} onChange={() => toggle(point.id)} className="mt-1 accent-teal-300" />
              <span className="min-w-0"><span className="block text-sm text-white">{point.title}</span><span className="mt-1 block text-xs text-zinc-500">{point.subject.name} · {masteryStatusLabel(point.masteryStatus)}{point.needsRetest ? " · 待复测" : ""}</span></span>
            </label>
          ))}
        </div>
        {!points.length ? <Alert tone="warning">还没有知识点，先在知识点工作台创建对象。</Alert> : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button className="af-container-action" type="button" variant="primary" size="lg" onClick={submit} loading={pending} disabled={!points.length}>安排并开始复测</Button>
      {conflict && !conflictOpen ? <Button type="button" variant="ghost" size="sm" onClick={prepareRetry}>保留输入并重试</Button> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="安排复测发生冲突"
        description="服务端拒绝了这次安排。当前表单输入已保留，系统不会自动重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? createConflictComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerVersion}
        onManualMerge={prepareRetry}
        mergeLabel="保留输入并重试"
      />
    </div>
  );
}

function createConflictComparisons(conflict: RetestCreateConflict) {
  return [
    { field: "title", label: "复测名称", local: conflict.payload.title, server: conflict.latest?.title ?? "无服务端版本" },
    { field: "method", label: "复测方法", local: conflict.payload.method, server: conflict.latest?.method ?? "无服务端版本" },
    { field: "knowledgePointIds", label: "知识点", local: conflict.payload.knowledgePointIds, server: conflict.latest?.points.map((point) => point.knowledgePointId) ?? "无服务端版本" },
  ];
}

function isKnowledgeRetestDetail(value: unknown): value is KnowledgeRetestDetailDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const detail = value as Partial<KnowledgeRetestDetailDto>;
  return typeof detail.id === "string"
    && typeof detail.revision === "number"
    && typeof detail.title === "string"
    && Array.isArray(detail.points);
}

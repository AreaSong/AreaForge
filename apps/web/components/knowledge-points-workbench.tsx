"use client";

import { createKnowledgePoint } from "@/lib/api/knowledge";
import { Plus, Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader, SectionHeader, Toolbar } from "@/components/ui/page";
import { KnowledgePointCard } from "@/components/knowledge-point-card";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { classifyApiFailure } from "@/lib/client/api-errors";
import type { SubjectDto, KnowledgePointDto } from "@/lib/contracts";
import {
  MASTERY_STATUS_OPTIONS,
  masteryStatusLabel,
  type MasteryStatus,
} from "@/lib/knowledge/mastery-status";

export function KnowledgePointsWorkbench(props: {
  subjects: SubjectDto[];
  knowledgePoints: KnowledgePointDto[];
  initialSubjectId?: string;
  initialQuery?: string;
  initialMasteryStatus?: MasteryStatus;
}) {
  const [subjectId, setSubjectId] = useState(props.initialSubjectId ?? "");
  const [masteryStatus, setMasteryStatus] = useState<MasteryStatus | "">(props.initialMasteryStatus ?? "");
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [title, setTitle] = useState("");
  const [boundary, setBoundary] = useState("");
  const [createSubjectId, setCreateSubjectId] = useState(props.initialSubjectId ?? props.subjects[0]?.id ?? "");
  const [createdPoints, setCreatedPoints] = useState<KnowledgePointDto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const points = useMemo(() => {
    const merged = [...createdPoints, ...props.knowledgePoints];
    const seen = new Set<string>();
    return merged.filter((point) => {
      if (seen.has(point.id)) return false;
      seen.add(point.id);
      return true;
    });
  }, [createdPoints, props.knowledgePoints]);

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    const payload = { subjectId: createSubjectId, title: title.trim(), boundary: boundary.trim() || null };
    if (!payload.subjectId || !payload.title) {
      setError("请选择科目并填写知识点名称。");
      return;
    }
    startTransition(async () => {
      const scope = `knowledge-point:create:${createSubjectId}`;
      const idempotencyKey = getOrCreateIdempotencyKey(scope, "knowledge-point", payload);
      const response = await createKnowledgePoint({ ...payload, idempotencyKey });
      const body = response.body;
      const createdPoint = body?.knowledgePoint;
      if (!response.ok || !createdPoint) {
        const failure = classifyApiFailure(response);
        setError(failure.kind === "conflict" ? "这个知识点已经存在，请换一个名称。" : "知识点创建失败，请稍后重试。");
        return;
      }
      completeIdempotentCommand(scope);
      setCreatedPoints((current) => [createdPoint, ...current]);
      setTitle("");
      setBoundary("");
      setNotice("知识点已加入知识中心。");
    });
  }

  const filteredPoints = points.filter((point) => {
    if (subjectId && point.subject.id !== subjectId) return false;
    if (masteryStatus && point.masteryStatus !== masteryStatus) return false;
    if (query.trim() && !point.title.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN"))) return false;
    return true;
  });
  const currentListHref = `/knowledge/points${new URLSearchParams(
    Object.entries({ subjectId, q: query, masteryStatus }).filter(([, value]) => Boolean(value)),
  ).toString() ? `?${new URLSearchParams(
    Object.entries({ subjectId, q: query, masteryStatus }).filter(([, value]) => Boolean(value)),
  ).toString()}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="知识 · 核心对象"
        title="知识点"
        description="知识点独立于考纲、任务和考试范围；每次学习、复测和复盘都会在这里汇聚掌握证据。"
      />

      <Card variant="master" className="p-5 sm:p-6">
        <SectionHeader title="新增知识点" description="先确定科目和知识边界，任务与考纲可以之后再关联。" />
        <form onSubmit={submitCreate} className="af-content-grid-form mt-4 grid min-w-0 gap-3">
          <Field label="科目" htmlFor="knowledge-point-create-subject">
            <Select id="knowledge-point-create-subject" value={createSubjectId} onChange={(event) => setCreateSubjectId(event.target.value)} className="h-10 bg-[#0b0e12] rounded-xl" disabled={!props.subjects.length}>
              <option value="">选择科目</option>{props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </Select>
          </Field>
          <Field label="知识点名称" htmlFor="knowledge-point-create-title">
            <Input id="knowledge-point-create-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} placeholder="例如：二次函数最值" className="h-10 bg-[#0b0e12] rounded-xl" />
          </Field>
          <Field label="边界（可选）" htmlFor="knowledge-point-create-boundary">
            <Input id="knowledge-point-create-boundary" value={boundary} onChange={(event) => setBoundary(event.target.value)} maxLength={3000} placeholder="说明要掌握什么、暂不包含什么" className="h-10 bg-[#0b0e12] rounded-xl" />
          </Field>
          <Button type="submit" variant="primary" loading={isPending} className="w-full self-end"><Plus size={16} aria-hidden />加入知识中心</Button>
        </form>
        {notice ? <Alert tone="success" className="mt-3">{notice}</Alert> : null}
        {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      </Card>

      <Toolbar label="知识点筛选">
        <label className="flex items-center gap-2 text-xs text-zinc-400">科目<Select aria-label="按科目筛选" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="!h-9 !w-auto rounded-xl bg-[#0b0e12] px-2 text-xs text-zinc-200"><option value="">全部科目</option>{props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</Select></label>
        <label className="flex items-center gap-2 text-xs text-zinc-400">状态<Select aria-label="按状态筛选" value={masteryStatus} onChange={(event) => setMasteryStatus(event.target.value as MasteryStatus | "")} className="!h-9 !w-auto rounded-xl bg-[#0b0e12] px-2 text-xs text-zinc-200"><option value="">全部状态</option>{MASTERY_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{masteryStatusLabel(status)}</option>)}</Select></label>
        <label className="flex w-full min-w-0 flex-1 items-center gap-2 border-t border-white/10 pt-2 text-xs text-zinc-400 sm:ml-auto sm:w-auto sm:min-w-48 sm:max-w-xs sm:border-l sm:border-t-0 sm:pl-2 sm:pt-0"><Search size={15} aria-hidden /><Input aria-label="搜索知识点" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识点" className="!h-9 !w-auto min-w-0 flex-1 border-transparent bg-transparent px-0 text-sm text-zinc-100 focus:border-transparent focus:ring-0" /></label>
      </Toolbar>

      {filteredPoints.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredPoints.map((point) => {
            const detailHref = withReturnTo(`/knowledge/points/${point.id}`, currentListHref);
            return <KnowledgePointCard key={point.id} point={point} detailHref={detailHref} />;
          })}
        </div>
      ) : (
        <EmptyState title="还没有匹配的知识点" description="从一个具体、可解释边界的知识点开始，后续学习与复测证据会持续汇聚到这里。" />
      )}
    </div>
  );
}

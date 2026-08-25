"use client";

import { createSimulationExam } from "@/lib/api/simulation";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { classifyApiFailure } from "@/lib/client/api-errors";
import { isShanghaiDateInputError, shanghaiDateInputToIso } from "@/lib/formatters";

export function SimulationListClient(props: { initialExamDate: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("模拟考试");
  const [examDate, setExamDate] = useState(props.initialExamDate);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function createExam(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = { name, examDate: shanghaiDateInputToIso(examDate) };
      const commandScope = "simulation-exam:create";
      const response = await createSimulationExam({
        ...payload,
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "simulation-exam", payload),
      });
      const body = response.body;
      if (classifyApiFailure(response).kind === "unauthorized") return redirectToLoginWithCurrentLocation();
      if (!response.ok || !body?.exam) {
        setError(body?.error ?? "创建模拟失败，当前输入仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      startTransition(() => router.push(`/test/simulations/${body.exam!.id}`));
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "考试日期无效，请重新选择；当前输入仍保留。"
        : "网络不可用，模拟考试输入仍保留；恢复网络后请显式重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="create-simulation" onSubmit={createExam} className="border-t border-white/10 pt-5">
      <SectionHeader title="创建新模拟" description="先建立一场考试，再进入详情录入分科成绩与失分事实。" />
      <div className="af-form-action-grid mt-3 grid gap-3">
        <Field label="名称" htmlFor="simulation-name">
          <Input id="simulation-name" className="mt-1 h-11 bg-[#151a20] text-white" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="日期" htmlFor="simulation-exam-date">
          <Input id="simulation-exam-date" type="date" className="mt-1 h-11 bg-[#151a20] text-white" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending || saving} loadingLabel="创建中..." className="self-end">创建考试</Button>
      </div>
      {error ? <Alert tone="danger" className="mt-2">{error}</Alert> : null}
    </form>
  );
}

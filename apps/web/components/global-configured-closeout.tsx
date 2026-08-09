"use client";

import { useEffect, useState } from "react";
import { KnowledgeRetestDetailClient } from "@/components/knowledge-retest-detail-client";
import { SimulationDetailClient } from "@/components/simulation-detail-client";
import { Alert } from "@/components/ui/feedback";
import type { KnowledgeRetestDetailDto } from "@/lib/study/knowledge-retest-service";
import type { SimulationRemediationDto } from "@/lib/study/simulation-service";
import type { SimulationExamDto, SyllabusOptionNodeDto } from "@/lib/study/types";

type CloseoutKind = "RETEST" | "SIMULATION";

export function GlobalConfiguredCloseout(props: {
  kind: CloseoutKind;
  entityId: string;
  userId: string;
  returnTo: string;
  initialNow: string;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: RetestData | SimulationData }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const request = props.kind === "RETEST"
      ? loadRetest(props.entityId)
      : loadSimulation(props.entityId);
    void request.then((data) => {
      if (!cancelled) setState({ status: "ready", data });
    }).catch((error: unknown) => {
      if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "无法加载活动收口内容。" });
    });
    return () => {
      cancelled = true;
    };
  }, [props.entityId, props.kind]);

  if (state.status === "loading") {
    return <p className="text-sm text-zinc-400" role="status">正在加载专属收口内容...</p>;
  }
  if (state.status === "error") {
    return <Alert tone="danger" title="收口内容加载失败">{state.message} 请刷新当前页面后重试，未提交的业务结果不会被自动覆盖。</Alert>;
  }

  if (props.kind === "RETEST" && isRetestData(state.data)) {
    return (
      <KnowledgeRetestDetailClient
        initial={state.data.retest}
        userId={props.userId}
        returnTo={props.returnTo}
        initialNow={props.initialNow}
        embeddedInWorkbench
      />
    );
  }
  if (props.kind === "SIMULATION" && isSimulationData(state.data)) {
    return (
      <SimulationDetailClient
        userId={props.userId}
        exam={state.data.exam}
        subjects={state.data.subjects}
        syllabus={state.data.syllabus}
        remediations={state.data.remediations}
        returnTo={props.returnTo}
        initialNow={props.initialNow}
        embeddedInWorkbench
      />
    );
  }

  return <Alert tone="danger">当前活动类型与收口对象不匹配，请刷新后重试。</Alert>;
}

interface RetestData {
  retest: KnowledgeRetestDetailDto;
}

interface SimulationData {
  exam: SimulationExamDto;
  subjects: Array<{ id: string; name: string }>;
  syllabus: SyllabusOptionNodeDto[];
  remediations: SimulationRemediationDto[];
}

async function loadRetest(id: string): Promise<RetestData> {
  const response = await fetch(`/api/knowledge-retests/${encodeURIComponent(id)}`, { cache: "no-store" });
  const body = await readJson(response) as { retest?: KnowledgeRetestDetailDto; error?: string };
  if (!response.ok || !body.retest) throw new Error(body.error ?? "专项复测不存在或已不可访问。");
  return { retest: body.retest };
}

async function loadSimulation(id: string): Promise<SimulationData> {
  const [examResponse, subjectsResponse, syllabusResponse, remediationsResponse] = await Promise.all([
    fetch(`/api/simulation-exams/${encodeURIComponent(id)}`, { cache: "no-store" }),
    fetch("/api/subjects", { cache: "no-store" }),
    fetch("/api/syllabus", { cache: "no-store" }),
    fetch(`/api/simulation-exams/${encodeURIComponent(id)}/remediations`, { cache: "no-store" }),
  ]);
  const examBody = await readJson(examResponse) as { exam?: SimulationExamDto; error?: string };
  const subjectsBody = await readJson(subjectsResponse) as { subjects?: Array<{ id: string; name: string }>; error?: string };
  const syllabusBody = await readJson(syllabusResponse) as { nodes?: SyllabusNodeLike[]; error?: string };
  const remediationsBody = await readJson(remediationsResponse) as { remediations?: SimulationRemediationDto[]; error?: string };
  if (!examResponse.ok || !examBody.exam) throw new Error(examBody.error ?? "模拟考试不存在或已不可访问。");
  if (!subjectsResponse.ok || !subjectsBody.subjects) throw new Error(subjectsBody.error ?? "无法加载当前科目。");
  if (!syllabusResponse.ok || !syllabusBody.nodes) throw new Error(syllabusBody.error ?? "无法加载考纲节点。");
  if (!remediationsResponse.ok || !remediationsBody.remediations) throw new Error(remediationsBody.error ?? "无法加载模拟补救建议。");
  return {
    exam: examBody.exam,
    subjects: subjectsBody.subjects,
    syllabus: toSyllabusOptions(syllabusBody.nodes),
    remediations: remediationsBody.remediations,
  };
}

interface SyllabusNodeLike {
  id: string;
  subjectId: string;
  title: string;
  children?: SyllabusNodeLike[];
}

function toSyllabusOptions(nodes: SyllabusNodeLike[]): SyllabusOptionNodeDto[] {
  return nodes.map((node) => ({
    id: node.id,
    subjectId: node.subjectId,
    title: node.title,
    children: toSyllabusOptions(node.children ?? []),
  }));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

function isRetestData(data: RetestData | SimulationData): data is RetestData {
  return "retest" in data;
}

function isSimulationData(data: RetestData | SimulationData): data is SimulationData {
  return "exam" in data;
}

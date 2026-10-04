"use client";

import { useRouter } from "next/navigation";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";

export function useStudyResourceListController(input: {
  initialQuery?: string;
}) {
  const router = useRouter();

  function updateSubjectFilter(value: string) {
    const query = new URLSearchParams();
    if (value) query.set("subjectId", value);
    if (input.initialQuery) query.set("q", input.initialQuery);
    updateKnowledgeContext({ subjectId: value || null, syllabusNodeId: null });
    router.push(`/knowledge/resources${query.size ? `?${query.toString()}` : ""}`);
  }

  function clearSubjectFilter() {
    updateKnowledgeContext({ subjectId: null, syllabusNodeId: null });
    const query = new URLSearchParams();
    if (input.initialQuery) query.set("q", input.initialQuery);
    router.push(`/knowledge/resources${query.size ? `?${query.toString()}` : ""}`);
  }

  return { updateSubjectFilter, clearSubjectFilter };
}

export type StudyResourceListController = ReturnType<typeof useStudyResourceListController>;

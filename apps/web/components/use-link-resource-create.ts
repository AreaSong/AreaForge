"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  isStudyResourceDto,
  splitTags,
} from "@/components/study-resource-workbench-support";
import type { StudyResourceDraftController } from "@/components/use-study-resource-draft";
import { createLinkStudyResource } from "@/lib/api/study-resource";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { useEntityOperationMap } from "@/lib/client/use-entity-operation-map";

export function useLinkResourceCreate(input: {
  draft: StudyResourceDraftController;
  initialQuery?: string;
  initialSubjectId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const operations = useEntityOperationMap<"create-link">();
  const pending = operations.get("create-link").pending;

  async function createLink() {
    const draft = input.draft;
    if (!draft.linkTitle.trim() || !draft.linkUrl.trim()) return;
    const generation = operations.tryBegin("create-link");
    if (generation === null) return;
    const submission = {
      title: draft.linkTitle,
      url: draft.linkUrl,
      subjectId: draft.subjectId || null,
      category: draft.category,
      tags: [...splitTags(draft.tags)],
    };
    setError(null);
    try {
      const response = await createLinkStudyResource(submission);
      const body = response.body;
      if (isUnauthorized(response)) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      const resource = body?.resource
        ?? (isConflict(response) && isStudyResourceDto(body?.latest) ? body.latest : null);
      if (!resource) {
        setError(response.ok
          ? "服务端未返回已创建资料，当前草稿已保留，请刷新后确认状态。"
          : body?.error ?? "外链资料创建失败，草稿已保留");
        return;
      }
      draft.resetLinkDraft();
      draft.setCreateOpen(false);
      router.push(withReturnTo(`/knowledge/resources/${resource.id}`, buildResourceListHref(input)));
    } catch {
      setError("网络不可用，外链资料草稿已保留；恢复网络后请显式重试。");
    } finally {
      operations.succeed("create-link", generation);
    }
  }

  return {
    pending,
    error,
    createLink: () => void createLink(),
  };
}

export type LinkResourceCreateController = ReturnType<typeof useLinkResourceCreate>;

function buildResourceListHref(input: { initialQuery?: string; initialSubjectId?: string }): string {
  const query = new URLSearchParams();
  if (input.initialSubjectId) query.set("subjectId", input.initialSubjectId);
  if (input.initialQuery) query.set("q", input.initialQuery);
  return `/knowledge/resources${query.size ? `?${query.toString()}` : ""}`;
}

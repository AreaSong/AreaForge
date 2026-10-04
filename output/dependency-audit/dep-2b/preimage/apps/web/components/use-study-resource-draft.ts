"use client";

import { useEffect, useState } from "react";
import {
  isResourceFormDraft,
  type ResourceFormDraft,
} from "@/components/study-resource-workbench-support";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { StudyResourceEditorOptionsDto } from "@/lib/contracts";

export function useStudyResourceDraft(input: {
  userId: string;
  options: StudyResourceEditorOptionsDto;
  initialCreate?: boolean;
  initialSubjectId?: string;
}) {
  const formDraftKey = `areaforge.resource.draft.form.${input.userId}`;
  const initialSubjectId = input.options.subjects.some((subject) => subject.id === input.initialSubjectId)
    ? input.initialSubjectId as string
    : input.options.subjects[0]?.id ?? "";
  const [mode, setMode] = useState<"files" | "link">("files");
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  const [category, setCategory] = useState("OTHER");
  const [tags, setTags] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [createOpen, setCreateOpen] = useState(Boolean(input.initialCreate));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(formDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isResourceFormDraft);
      if (draft) {
        setMode(draft.mode);
        setSubjectId(draft.subjectId);
        setCategory(draft.category);
        setTags(draft.tags);
        setLinkTitle(draft.linkTitle);
        setLinkUrl(draft.linkUrl);
        setCreateOpen(true);
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formDraftKey]);

  function changeSubject(value: string) {
    setSubjectId(value);
    updateKnowledgeContext({ subjectId: value || null, syllabusNodeId: null });
  }

  function resetLinkDraft() {
    setLinkTitle("");
    setLinkUrl("");
    setTags("");
    removePrivateBusinessDraft(formDraftKey);
  }

  return {
    formDraftKey,
    ready,
    mode,
    subjectId,
    category,
    tags,
    linkTitle,
    linkUrl,
    createOpen,
    setMode,
    setSubjectId,
    setCategory,
    setTags,
    setLinkTitle,
    setLinkUrl,
    setCreateOpen,
    changeSubject,
    resetLinkDraft,
  };
}

export type StudyResourceDraftController = ReturnType<typeof useStudyResourceDraft>;

export function useStudyResourceDraftPersistence(
  draft: StudyResourceDraftController,
  hasDuplicateUpload: boolean,
) {
  useEffect(() => {
    if (!draft.ready) return;
    if (!draft.linkTitle && !draft.linkUrl && !draft.tags && !hasDuplicateUpload) {
      removePrivateBusinessDraft(draft.formDraftKey);
      return;
    }
    savePrivateBusinessDraft<ResourceFormDraft>(draft.formDraftKey, {
      mode: draft.mode,
      subjectId: draft.subjectId,
      category: draft.category,
      tags: draft.tags,
      linkTitle: draft.linkTitle,
      linkUrl: draft.linkUrl,
    });
  }, [
    draft.category,
    draft.formDraftKey,
    draft.linkTitle,
    draft.linkUrl,
    draft.mode,
    draft.ready,
    draft.subjectId,
    draft.tags,
    hasDuplicateUpload,
  ]);
}

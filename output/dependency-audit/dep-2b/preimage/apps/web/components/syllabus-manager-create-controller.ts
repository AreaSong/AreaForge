"use client";

import type { SyllabusCommandRuntime } from "@/components/syllabus-manager-command-runtime";
import {
  isSyllabusCreateDraft,
  isSyllabusImportDraft,
  syllabusCreateDraftKey,
  syllabusImportDraftKey,
} from "@/components/syllabus-manager-support";
import type { SyllabusWorkbenchController } from "@/components/syllabus-manager-workbench-controller";
import { createSyllabusNode, importSyllabusMarkdown } from "@/lib/api/syllabus";
import { mutationFeedback } from "@/lib/client/mutation-feedback";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import {
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
  SHORT_PRIVATE_DRAFT_TTL_MS,
} from "@/lib/client/private-business-drafts";
import type { SyllabusNodeDto, SyllabusNodeKindDto, SyllabusNodeStatusDto } from "@/lib/contracts";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { type FormEvent, useEffect, useState } from "react";

export function useSyllabusCreateController({
  workbench,
  runtime,
  initialCreate,
}: {
  workbench: SyllabusWorkbenchController;
  runtime: SyllabusCommandRuntime;
  initialCreate: boolean;
}) {
  const [parentId, setParentId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SyllabusNodeKindDto>("topic");
  const [status, setStatus] = useState<SyllabusNodeStatusDto>("not_started");
  const [targetMinutes, setTargetMinutes] = useState(45);
  const [importMarkdown, setImportMarkdown] = useState("");
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [createOpen, setCreateOpen] = useState(initialCreate);
  const subjects = workbench.subjects;
  const setSubjectId = workbench.setSubjectId;

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const createDraft = loadPrivateBusinessDraft(
        syllabusCreateDraftKey,
        SHORT_PRIVATE_DRAFT_TTL_MS,
        isSyllabusCreateDraft,
      );
      if (createDraft) {
        setSubjectId(resolveSubjectId(subjects, createDraft.subjectId));
        setParentId(createDraft.parentId ?? "");
        setTitle(createDraft.title);
        setKind(createDraft.kind);
        setStatus(createDraft.status);
        setTargetMinutes(createDraft.targetMinutes);
      }
      const importDraft = loadPrivateBusinessDraft(
        syllabusImportDraftKey,
        SHORT_PRIVATE_DRAFT_TTL_MS,
        isSyllabusImportDraft,
      );
      if (importDraft) {
        setSubjectId(resolveSubjectId(subjects, importDraft.subjectId));
        setParentId(importDraft.parentId ?? "");
        setImportMarkdown(importDraft.markdown);
      }
      setDraftsLoaded(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [setSubjectId, subjects]);

  useEffect(() => {
    if (!draftsLoaded) return;
    if (!title.trim() && !parentId && kind === "topic" && status === "not_started" && targetMinutes === 45) {
      removePrivateBusinessDraft(syllabusCreateDraftKey);
      return;
    }
    savePrivateBusinessDraft(syllabusCreateDraftKey, {
      subjectId: workbench.subjectId,
      parentId: parentId || null,
      title,
      kind,
      status,
      targetMinutes,
    });
  }, [draftsLoaded, workbench.subjectId, parentId, title, kind, status, targetMinutes]);

  useEffect(() => {
    if (!draftsLoaded) return;
    if (!importMarkdown.trim()) {
      removePrivateBusinessDraft(syllabusImportDraftKey);
      return;
    }
    savePrivateBusinessDraft(syllabusImportDraftKey, {
      subjectId: workbench.subjectId,
      parentId: parentId || null,
      markdown: importMarkdown,
    });
  }, [draftsLoaded, workbench.subjectId, parentId, importMarkdown]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runtime.setError(null);
    setImportNotice(null);
    const payload = {
      subjectId: workbench.subjectId,
      parentId: parentId || null,
      title,
      kind,
      status,
      targetMinutes,
    };
    const commandScope = `syllabus-node:${workbench.subjectId}:create`;
    savePrivateBusinessDraft(syllabusCreateDraftKey, payload);
    runtime.setPendingCommand("create");
    try {
      const response = await createSyllabusNode({
        ...payload,
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "syllabus-node", payload),
      });
      if (!response.ok) {
        handleWorkbenchFailure(response, runtime);
        runtime.setError(mutationFeedback(response, "创建考纲节点失败，草稿与重试标识已保留").message);
        return;
      }
      const node = response.body?.node;
      if (!node) {
        runtime.setError("服务端未返回已创建节点，当前输入与重试标识仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      removePrivateBusinessDraft(syllabusCreateDraftKey);
      workbench.addCreatedNode(node as SyllabusNodeDto);
      setTitle("");
      setParentId("");
      setCreateOpen(false);
      runtime.push(withReturnTo(`/knowledge/syllabi/${node.id}`, workbench.currentWorkbenchHref));
    } catch {
      runtime.setError("网络中断，创建草稿与同一重试标识已保留，请明确重试");
    } finally {
      runtime.setPendingCommand(null);
    }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runtime.setError(null);
    setImportNotice(null);
    const payload = {
      subjectId: workbench.subjectId,
      parentId: parentId || null,
      markdown: importMarkdown,
    };
    const commandScope = `syllabus-markdown-import:${workbench.subjectId}`;
    savePrivateBusinessDraft(syllabusImportDraftKey, payload);
    runtime.setPendingCommand("import");
    try {
      const response = await importSyllabusMarkdown({
        ...payload,
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "syllabus-import", payload),
      });
      if (!response.ok) {
        handleWorkbenchFailure(response, runtime);
        runtime.setError(mutationFeedback(response, "导入考纲失败，Markdown 与重试标识已保留").message);
        return;
      }
      const result = response.body?.import;
      if (!result) {
        runtime.setError("服务端未返回导入结果，当前 Markdown 与重试标识仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      removePrivateBusinessDraft(syllabusImportDraftKey);
      setImportMarkdown("");
      setImportNotice(`已导入 ${result.importedCount} 个节点${result.ignoredLines.length > 0 ? `，忽略 ${result.ignoredLines.length} 行` : ""}。`);
      runtime.refresh();
    } catch {
      runtime.setError("网络中断，导入草稿与同一重试标识已保留，请明确重试");
    } finally {
      runtime.setPendingCommand(null);
    }
  }

  function changeSubject(subjectId: string) {
    workbench.setSubjectId(subjectId);
    setParentId("");
    updateKnowledgeContext({ subjectId, syllabusNodeId: null });
  }

  return {
    state: {
      parentId,
      title,
      kind,
      status,
      targetMinutes,
      importMarkdown,
      importNotice,
      createOpen,
    },
    actions: {
      setParentId,
      setTitle,
      setKind,
      setStatus,
      setTargetMinutes,
      setImportMarkdown,
      setCreateOpen,
      changeSubject,
      submitCreate,
      submitImport,
    },
  };
}

export type SyllabusCreateController = ReturnType<typeof useSyllabusCreateController>;

function resolveSubjectId(subjects: SyllabusWorkbenchController["subjects"], candidate: string): string {
  return subjects.some((subject) => subject.id === candidate) ? candidate : subjects[0]?.id ?? "";
}

function handleWorkbenchFailure(
  response: Parameters<typeof mutationFeedback>[0] & { body?: { workbench?: string } | null },
  runtime: SyllabusCommandRuntime,
) {
  if (mutationFeedback(response, "").kind === "unauthorized") redirectToLoginWithCurrentLocation();
  else if (response.status === 404 && response.body?.workbench === "/knowledge/syllabi") {
    runtime.replace(response.body.workbench);
  }
}

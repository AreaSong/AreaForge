"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { NoteLibraryView } from "@/components/note-library-view";
import { useRestoreListReturn } from "@/components/list-return-context";
import {
  buildNoteListHref,
  flattenNodes,
  isNoteFormDraft,
  isNoteKind,
  isNoteMasteryFilter,
  isNoteReviewFilter,
  labelAttachmentError,
  matchesMastery,
  matchesNode,
  matchesReview,
  matchesSubject,
  type NoteFormDraft,
  type NoteLibraryProps,
} from "@/components/note-library-support";
import { createNote } from "@/lib/api/notes";
import { uploadNoteAttachment } from "@/lib/api/uploads";
import { isUnauthorized } from "@/lib/client/api-errors";
import { mutationFeedback } from "@/lib/client/mutation-feedback";
import {
  aiDraftHandoffKey,
  readAiDraftHandoffEnvelope,
  subscribeAiDraftHandoff,
} from "@/lib/client/ai-draft-handoff";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import {
  loadPrivateBusinessDraftEnvelope,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { getBrowserStoragePort } from "@/lib/client/storage-port";
import { isDraftAtLeastAsNew } from "@/lib/client/draft-store";
import { useEntityOperationMap } from "@/lib/client/use-entity-operation-map";
import { useKeyedDraftHydration } from "@/lib/client/use-keyed-draft-hydration";
import { useUrlSyncedFilters } from "@/lib/client/use-url-synced-filters";
import type { NoteDto, NoteMasteryStatusDto } from "@/lib/contracts";
import { isShanghaiDateInputError, shanghaiDateTimeInputToIso } from "@/lib/formatters";
import { withReturnTo } from "@/lib/navigation/app-navigation";

export function NoteLibrary(props: NoteLibraryProps) {
  const controller = useNoteLibraryController(props);
  return <NoteLibraryView controller={controller} />;
}

function useNoteLibraryController({
  userId,
  subjects,
  tasks,
  nodes,
  notes,
  initialSubjectId,
  initialSyllabusNodeId,
  initialTaskId,
  initialMasteryStatus,
  initialReviewFilter,
  initialQuery,
  initialCreate,
}: NoteLibraryProps) {
  const router = useRouter();
  const createTitleRef = useRef<HTMLInputElement>(null);
  const formDraftKey = `areaforge.note.draft.${userId}.create`;
  const {
    ready: draftReady,
    begin: beginDraftHydration,
    isCurrent: isDraftHydrationCurrent,
    complete: completeDraftHydration,
    cancel: cancelDraftHydration,
  } = useKeyedDraftHydration(formDraftKey);
  useRestoreListReturn();
  const initialSubject = subjects.some((subject) => subject.id === initialSubjectId)
    ? initialSubjectId as string
    : subjects[0]?.id ?? "";
  const initialNode = flattenNodes(nodes).some((node) =>
    node.id === initialSyllabusNodeId && node.subjectId === initialSubject)
    ? initialSyllabusNodeId as string
    : "";
  const initialTask = tasks.some((task) => task.id === initialTaskId && task.subjectId === initialSubject)
    ? initialTaskId as string
    : "";
  const [subjectId, setSubjectId] = useState(initialSubject);
  const [syllabusNodeId, setSyllabusNodeId] = useState(initialNode);
  const [taskId, setTaskId] = useState(initialTask);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<NoteFormDraft["kind"]>("GENERAL");
  const [masteryStatus, setMasteryStatus] = useState<NoteMasteryStatusDto>("partial");
  const [nextReviewAt, setNextReviewAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createdNotes, setCreatedNotes] = useState<NoteDto[]>([]);
  const [createOpen, setCreateOpen] = useState(Boolean(initialCreate));
  const [observedInitialCreate, setObservedInitialCreate] = useState(Boolean(initialCreate));
  if (observedInitialCreate !== Boolean(initialCreate)) {
    setObservedInitialCreate(Boolean(initialCreate));
    if (initialCreate) setCreateOpen(true);
  }
  const [isPending, startTransition] = useTransition();
  const attachmentOperations = useEntityOperationMap<string>();
  const filterSource = {
    subject: initialSubjectId && subjects.some((subject) => subject.id === initialSubjectId)
      ? initialSubjectId
      : "all",
    node: initialNode || "all",
    mastery: isNoteMasteryFilter(initialMasteryStatus) ? initialMasteryStatus : "all",
    review: isNoteReviewFilter(initialReviewFilter) ? initialReviewFilter : "all",
  } satisfies NoteListFilters;
  const { filters: listFilters, commit: applyListFilters } = useUrlSyncedFilters({
    source: filterSource,
    sourceKey: [filterSource.subject, filterSource.node, filterSource.mastery, filterSource.review].join("\u0000"),
    onCommit: (filters) => {
      updateKnowledgeContext({
        subjectId: filters.subject === "all" ? null : filters.subject,
        syllabusNodeId: filters.node === "all" || filters.node === "none" ? null : filters.node,
      });
      router.replace(buildNoteListHref({ query: initialQuery, ...filters }));
    },
  });
  const {
    subject: noteSubjectFilter,
    node: noteNodeFilter,
    mastery: noteMasteryFilter,
    review: noteReviewFilter,
  } = listFilters;

  useEffect(() => {
    if (!createOpen) return;
    const timer = window.setTimeout(() => createTitleRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [createOpen]);

  const applyKnowledgeCardHandoff = useCallback((value: KnowledgeCardHandoff) => {
    setTitle(value.title);
    setContent(value.body);
    if (isNoteKind(value.kindHint)) setKind(value.kindHint);
    setCreateOpen(true);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAiDraftHandoff({
      endpoint: "knowledge-card",
      userId,
      isValue: isKnowledgeCardHandoff,
      onValue: applyKnowledgeCardHandoff,
    });
    return unsubscribe;
  }, [applyKnowledgeCardHandoff, userId]);

  useEffect(() => {
    const token = beginDraftHydration();
    const timer = window.setTimeout(() => {
      const localDraft = loadPrivateBusinessDraftEnvelope(
        formDraftKey,
        LONG_PRIVATE_DRAFT_TTL_MS,
        isNoteFormDraft,
      );
      const storage = getBrowserStoragePort("local");
      const aiDraft = storage ? readAiDraftHandoffEnvelope(storage, {
        endpoint: "knowledge-card",
        userId,
        isValue: isKnowledgeCardHandoff,
      }) : null;
      if (!isDraftHydrationCurrent(token)) return;
      if (localDraft) {
        setSubjectId(localDraft.value.subjectId);
        setSyllabusNodeId(localDraft.value.syllabusNodeId);
        setTaskId(localDraft.value.taskId);
        setTitle(localDraft.value.title);
        setContent(localDraft.value.content);
        setKind(localDraft.value.kind);
        setMasteryStatus(localDraft.value.masteryStatus);
        setNextReviewAt(localDraft.value.nextReviewAt);
      }
      if (aiDraft && isDraftAtLeastAsNew(aiDraft, localDraft)) {
        applyKnowledgeCardHandoff(aiDraft.value);
      }
      completeDraftHydration(token);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      cancelDraftHydration(token);
    };
  }, [applyKnowledgeCardHandoff, beginDraftHydration, cancelDraftHydration, completeDraftHydration, formDraftKey, isDraftHydrationCurrent, userId]);

  useEffect(() => {
    if (!draftReady) return;
    if (!title && !content) {
      removePrivateBusinessDraft(formDraftKey);
      return;
    }
    savePrivateBusinessDraft<NoteFormDraft>(formDraftKey, {
      subjectId,
      syllabusNodeId,
      taskId,
      title,
      content,
      kind,
      masteryStatus,
      nextReviewAt,
    });
  }, [content, draftReady, formDraftKey, kind, masteryStatus, nextReviewAt, subjectId, syllabusNodeId, taskId, title]);

  const flatNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const nodeOptions = flatNodes.filter((node) => node.subjectId === subjectId);
  const taskOptions = tasks.filter((task) => task.subjectId === subjectId);
  const filterNodeOptions = useMemo(
    () => flatNodes.filter((node) => noteSubjectFilter === "all" || node.subjectId === noteSubjectFilter),
    [flatNodes, noteSubjectFilter],
  );
  const visibleNotes = useMemo(
    () => [...createdNotes.filter((created) => !notes.some((note) => note.id === created.id)), ...notes],
    [createdNotes, notes],
  );
  const filteredNotes = useMemo(
    () => visibleNotes.filter((note) =>
      matchesSubject(note, noteSubjectFilter)
      && matchesNode(note, noteNodeFilter)
      && matchesMastery(note, noteMasteryFilter)
      && matchesReview(note, noteReviewFilter)),
    [visibleNotes, noteSubjectFilter, noteNodeFilter, noteMasteryFilter, noteReviewFilter],
  );
  const hasListFilters = noteSubjectFilter !== "all"
    || noteNodeFilter !== "all"
    || noteMasteryFilter !== "all"
    || noteReviewFilter !== "all";
  const currentListHref = buildNoteListHref({
    query: initialQuery,
    subject: noteSubjectFilter,
    node: noteNodeFilter,
    mastery: noteMasteryFilter,
    review: noteReviewFilter,
  });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const commandScope = `note:create:${userId}`;
    let createdNote: NoteDto | null = null;
    setSaving(true);
    try {
      const payload = {
        subjectId,
        syllabusNodeId: syllabusNodeId || null,
        taskId: taskId || null,
        kind,
        title,
        content,
        masteryStatus,
        nextReviewAt: nextReviewAt ? shanghaiDateTimeInputToIso(nextReviewAt) : null,
      };
      const response = await createNote({
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "note-create", payload),
        ...payload,
      });
      if (isUnauthorized(response)) {
        setError("登录已过期，卡片草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        const feedback = mutationFeedback(response, "保存卡片失败，草稿已保留");
        if (feedback.kind === "unauthorized") redirectToLoginWithCurrentLocation();
        setError(feedback.message);
        return;
      }
      if (!response.body?.note) {
        setError("服务端未返回已创建卡片，当前草稿与重试标识仍保留");
        return;
      }
      createdNote = response.body.note;
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "下次复习时间无效，卡片草稿已保留；请重新选择日期和时间。"
        : "网络不可用，卡片草稿已保留；恢复网络后请显式重试。");
      return;
    } finally {
      setSaving(false);
    }

    if (!createdNote) return;
    completeIdempotentCommand(commandScope);
    setCreatedNotes((current) => current.some((note) => note.id === createdNote.id)
      ? current
      : [createdNote, ...current]);
    setTitle("");
    setContent("");
    setKind("GENERAL");
    getBrowserStoragePort("local")?.removeItem(aiDraftHandoffKey("knowledge-card", userId));
    removePrivateBusinessDraft(formDraftKey);
    setSyllabusNodeId("");
    setTaskId("");
    setNextReviewAt("");
    setCreateOpen(false);
    startTransition(() => router.push(withReturnTo(`/knowledge/cards/${createdNote.id}`, currentListHref)));
  }

  async function uploadAttachment(noteId: string, file: File | undefined) {
    if (!file) return;
    const generation = attachmentOperations.tryBegin(noteId);
    if (generation === null) return;
    const commandScope = `note-attachment:upload:${userId}:${noteId}`;
    const idempotencyKey = getOrCreateIdempotencyKey(commandScope, "note-attachment", {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    });
    const formData = new FormData();
    formData.append("file", file);
    try {
      const result = await uploadNoteAttachment(noteId, formData, idempotencyKey);
      if (isUnauthorized(result)) {
        attachmentOperations.fail(noteId, generation, "登录已过期；上传命令身份已保留。重新登录并选择同一文件后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!result.ok) {
        const feedback = mutationFeedback(result, labelAttachmentError(result.body?.error));
        if (feedback.kind === "unauthorized") redirectToLoginWithCurrentLocation();
        attachmentOperations.fail(noteId, generation, feedback.message);
        return;
      }
      completeIdempotentCommand(commandScope);
      attachmentOperations.succeed(noteId, generation);
      startTransition(() => router.refresh());
    } catch {
      attachmentOperations.fail(noteId, generation, "网络不可用，附件未上传；请恢复网络后重新选择文件。");
    }
  }

  return {
    subjects, initialQuery, createTitleRef,
    subjectId, setSubjectId, syllabusNodeId, setSyllabusNodeId, taskId, setTaskId,
    title, setTitle, content, setContent, kind, setKind, masteryStatus, setMasteryStatus,
    nextReviewAt, setNextReviewAt, error, saving, createOpen, setCreateOpen, isPending,
    nodeOptions, taskOptions, filterNodeOptions, visibleNotes, filteredNotes, hasListFilters,
    noteSubjectFilter, noteNodeFilter, noteMasteryFilter, noteReviewFilter, applyListFilters,
    attachmentOperations, submit, uploadAttachment,
  };
}

export type NoteLibraryController = ReturnType<typeof useNoteLibraryController>;

interface NoteListFilters {
  subject: string;
  node: string;
  mastery: "all" | NoteMasteryStatusDto;
  review: "all" | "due" | "scheduled" | "none";
}

interface KnowledgeCardHandoff {
  title: string;
  body: string;
  kindHint: string;
}

function isKnowledgeCardHandoff(value: unknown): value is KnowledgeCardHandoff {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<KnowledgeCardHandoff>;
  return typeof draft.title === "string"
    && typeof draft.body === "string"
    && isNoteKind(draft.kindHint);
}

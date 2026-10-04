import { useState, type Dispatch, type SetStateAction } from "react";
import {
  createSimulationLossItem,
  getSimulationExam,
  setSimulationLossItemArchiveState,
  updateSimulationLossItem,
  type SimulationLossItemMutationResponse,
} from "@/lib/api/simulation";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { SimulationExamDto, SimulationLossItemDto } from "@/lib/contracts";
import {
  isSimulationExamDto,
  isSimulationLossItemDto,
  labelLossItemError,
  lossMutationNotice,
  replaceLossConflictItem,
  toLossItemDraft,
  type LossItemAction,
  type LossItemConflict,
  type SimulationLossItemDraft,
  type SubjectDraft,
} from "@/components/simulation-detail-drafts";

interface SimulationLossItemsOptions {
  examId: string;
  examRevision: number;
  busy: boolean;
  subjectDrafts: SubjectDraft[];
  setExamRevision: Dispatch<SetStateAction<number>>;
  setExamStatus: Dispatch<SetStateAction<SimulationExamDto["status"]>>;
  setSubjectDrafts: Dispatch<SetStateAction<SubjectDraft[]>>;
  setSubmitting: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  onExamConflict: (latest: SimulationExamDto, conflictFields: string[]) => void;
  onNotFound: () => void;
  onRefresh: () => void;
}

export function useSimulationLossItems(options: SimulationLossItemsOptions) {
  const [conflict, setConflict] = useState<LossItemConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const conflictedItem = conflict
    ? options.subjectDrafts
        .find((draft) => draft.subjectId === conflict.subjectId)
        ?.lossItems.find((item) => item.clientKey === conflict.clientKey)
    : undefined;

  async function mutate(subject: SubjectDraft, item: SimulationLossItemDraft, action: LossItemAction) {
    if (options.busy) return;
    if (!subject.subjectResultId) {
      options.setError("该分科尚未建立，请先保存整场分科结果；失分条目会在同一事务中创建。");
      return;
    }
    if (subject.expectedRevision == null) {
      options.setError("分科结果缺少 revision，请刷新后核对。");
      return;
    }
    if ((action !== "save" || item.id) && (!item.id || item.revision == null)) {
      options.setError("失分条目缺少稳定版本信息，请刷新后核对。");
      return;
    }

    options.setError(null);
    options.setNotice(null);
    options.setSubmitting(true);
    const commandScope = `simulation-loss:${options.examId}:${subject.subjectId}:${item.clientKey}`;
    const creating = action === "save" && !item.id;
    const parentRevisions = {
      expectedExamRevision: options.examRevision,
      expectedSubjectResultRevision: subject.expectedRevision,
    };

    try {
      const savePayload = {
        ...parentRevisions,
        reason: item.reason,
        syllabusNodeId: item.syllabusNodeId,
        lostScore: item.lostScore,
        note: item.note || null,
      };
      const response = creating
        ? await createSimulationLossItem(subject.subjectResultId, {
            ...savePayload,
            idempotencyKey: getOrCreateIdempotencyKey(
              commandScope,
              "simulation-loss-create",
              savePayload,
            ),
          })
        : action === "save"
          ? await updateSimulationLossItem(subject.subjectResultId, item.id as string, {
              ...savePayload,
              expectedRevision: item.revision as number,
            })
          : await setSimulationLossItemArchiveState(
              subject.subjectResultId,
              item.id as string,
              action,
              { ...parentRevisions, expectedRevision: item.revision as number },
            );
      const body = response.body ?? {};
      if (!response.ok) {
        handleWriteFailure(response.status, body, subject, item, action);
        return;
      }
      if (!body.lossItem || !body.versions) {
        options.setError("条目可能已写入，但服务端未返回父版本；请刷新页面核对后再继续。");
        return;
      }
      if (creating) completeIdempotentCommand(commandScope);
      adoptMutation(subject.subjectId, item, action, body.lossItem, body.versions);
      options.setNotice(lossMutationNotice(creating ? "create" : action));
      options.onRefresh();
    } catch {
      options.setError("网络结果未知，失分操作意图仍保留；请先刷新核对服务端状态，再显式重试。");
    } finally {
      options.setSubmitting(false);
    }
  }

  function handleWriteFailure(
    status: number,
    body: SimulationLossItemMutationResponse,
    subject: SubjectDraft,
    item: SimulationLossItemDraft,
    action: LossItemAction,
  ) {
    const source = { status, body };
    if (isUnauthorized(source)) {
      options.setError("登录已过期，失分操作意图仍保留。重新登录后请显式重试。");
      redirectToLoginWithCurrentLocation();
      return;
    }
    if (status === 404) {
      options.setError("失分条目或分科结果已不存在；当前输入仍保留，正在返回模拟工作台。");
      options.onNotFound();
      return;
    }
    if (isConflict(source) && isSimulationLossItemDto(body.latest)) {
      setConflict({
        subjectId: subject.subjectId,
        clientKey: item.clientKey,
        action,
        latest: body.latest,
        conflictFields: body.conflictFields ?? ["revision"],
      });
      setConflictOpen(true);
    } else if (isConflict(source) && isSimulationExamDto(body.latest)) {
      options.onExamConflict(body.latest, body.conflictFields ?? ["revision"]);
    }
    options.setError(labelLossItemError(body.error));
  }

  function adoptMutation(
    subjectId: string,
    submitted: SimulationLossItemDraft,
    action: LossItemAction,
    lossItem: SimulationLossItemDto,
    versions: NonNullable<SimulationLossItemMutationResponse["versions"]>,
  ) {
    options.setExamRevision(versions.examRevision);
    options.setExamStatus(versions.examStatus);
    options.setSubjectDrafts((drafts) => drafts.map((draft) => draft.subjectId !== subjectId ? draft : {
      ...draft,
      expectedRevision: versions.subjectResultRevision,
      lossItems: draft.lossItems.map((candidate) => {
        if (candidate.clientKey !== submitted.clientKey) return candidate;
        if (action === "restore" && candidate.dirty) {
          return {
            ...candidate,
            clientKey: lossItem.id,
            id: lossItem.id,
            revision: lossItem.revision,
            archivedAt: lossItem.archivedAt,
          };
        }
        return toLossItemDraft(lossItem);
      }),
    }));
  }

  function adoptServerVersion() {
    if (!conflict) return;
    const current = conflict;
    options.setSubjectDrafts((drafts) => replaceLossConflictItem(drafts, current, false));
    setConflict(null);
    setConflictOpen(false);
    options.setError(null);
    options.setNotice("已采用服务端失分条目；原操作未重放。");
    void refreshParentVersions(current.subjectId);
  }

  function keepIntentOnLatestRevision() {
    if (!conflict) return;
    const current = conflict;
    options.setSubjectDrafts((drafts) => replaceLossConflictItem(drafts, current, true));
    setConflict(null);
    setConflictOpen(false);
    options.setError(null);
    options.setNotice("已基于服务端最新 revision 保留本地输入或生命周期意图，请检查后再次提交。");
    void refreshParentVersions(current.subjectId);
  }

  async function refreshParentVersions(subjectId: string) {
    try {
      const response = await getSimulationExam(options.examId);
      const body = response.body ?? {};
      if (!response.ok || !body.exam) {
        options.setError("无法刷新模拟父版本，请刷新页面后再继续写入。");
        return;
      }
      const subject = body.exam.subjectResults.find((result) => result.subjectId === subjectId);
      options.setExamRevision(body.exam.revision);
      options.setExamStatus(body.exam.status);
      options.setSubjectDrafts((drafts) => drafts.map((draft) => draft.subjectId === subjectId
        ? { ...draft, subjectResultId: subject?.id ?? draft.subjectResultId, expectedRevision: subject?.revision }
        : draft));
    } catch {
      options.setError("网络不可用，无法刷新模拟父版本；请刷新页面后再继续写入。");
    }
  }

  return {
    conflict,
    conflictOpen,
    conflictedItem,
    setConflictOpen,
    mutate,
    adoptServerVersion,
    keepIntentOnLatestRevision,
  };
}

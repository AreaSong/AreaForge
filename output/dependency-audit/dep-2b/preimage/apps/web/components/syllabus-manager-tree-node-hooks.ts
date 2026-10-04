"use client";

import {
  getMasteryEvidenceReferenceKey,
} from "@/components/syllabus-manager-labels";
import {
  isMasteryEvidenceFormDraft,
  isMasteryRetestFormDraft,
  syllabusEvidenceDraftKey,
  syllabusRetestDraftKey,
} from "@/components/syllabus-manager-support";
import type {
  AddMasteryEvidenceBody,
  AddMasteryRetestBody,
  MasteryCondition,
  MasteryEvidenceFormDraft,
  MasteryEvidenceType,
  MasteryRetestFormDraft,
  MasteryRetestResult,
  SyllabusTreeNodeProps,
} from "@/components/syllabus-manager-types";
import {
  loadPrivateBusinessDraft,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
  SHORT_PRIVATE_DRAFT_TTL_MS,
} from "@/lib/client/private-business-drafts";
import { syllabusLevelForMasteryStatus, type MasteryStatus } from "@/lib/knowledge/mastery-status";
import {
  isShanghaiDateInputError,
  shanghaiDateInputToIso,
  shanghaiDateTimeInputToIso,
} from "@/lib/formatters";
import { useEffect, useState } from "react";

type NodeCommands = Pick<SyllabusTreeNodeProps, "onUpdate" | "onAddMasteryEvidence" | "onAddMasteryRetest">;

export function useSyllabusMasteryControls(
  node: SyllabusTreeNodeProps["node"],
  onUpdate: NodeCommands["onUpdate"],
) {
  const [targetMasteryStatus, setTargetMasteryStatus] = useState<MasteryStatus>(node.masteryStatus);
  const [selectedConditions, setSelectedConditions] = useState<MasteryCondition[]>(node.masteryConditions);
  const targetMasteryLevel = syllabusLevelForMasteryStatus(targetMasteryStatus);

  function toggleCondition(condition: MasteryCondition) {
    setSelectedConditions((current) => current.includes(condition)
      ? current.filter((item) => item !== condition)
      : [...current, condition]);
  }

  function saveConditions() {
    void onUpdate(node.id, { masteryConditions: selectedConditions });
  }

  function proveMastery() {
    void onUpdate(node.id, {
      status: "mastered",
      masteryLevel: targetMasteryLevel,
      masteryConditions: selectedConditions,
    });
  }

  return {
    state: {
      targetMasteryStatus,
      targetMasteryLevel,
      selectedConditions,
      selectedConditionSet: new Set(selectedConditions),
    },
    actions: { setTargetMasteryStatus, toggleCondition, saveConditions, proveMastery },
  };
}

export type SyllabusMasteryControls = ReturnType<typeof useSyllabusMasteryControls>;

export function useSyllabusEvidenceForm(
  node: SyllabusTreeNodeProps["node"],
  onAddMasteryEvidence: NodeCommands["onAddMasteryEvidence"],
) {
  const [evidenceType, setEvidenceType] = useState<MasteryEvidenceType>("task");
  const [evidenceReferenceId, setEvidenceReferenceId] = useState(node.masteryEvidenceCandidates.task[0]?.id ?? "");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const draftKey = syllabusEvidenceDraftKey(node.id);
  const evidenceCandidates = node.masteryEvidenceCandidates[evidenceType];
  const selectedReferenceId = evidenceCandidates.some((candidate) => candidate.id === evidenceReferenceId)
    ? evidenceReferenceId
    : evidenceCandidates[0]?.id ?? "";

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(draftKey, SHORT_PRIVATE_DRAFT_TTL_MS, isMasteryEvidenceFormDraft);
      if (draft) {
        setEvidenceType(draft.evidenceType);
        setEvidenceReferenceId(draft.evidenceReferenceId);
        setEvidenceSummary(draft.evidenceSummary);
      }
      setDraftLoaded(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [draftKey]);

  useEffect(() => {
    if (!draftLoaded) return;
    const defaultReferenceId = node.masteryEvidenceCandidates.task[0]?.id ?? "";
    const dirty = evidenceType !== "task"
      || evidenceReferenceId !== defaultReferenceId
      || evidenceSummary.trim().length > 0;
    if (!dirty) {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    savePrivateBusinessDraft<MasteryEvidenceFormDraft>(draftKey, {
      evidenceType,
      evidenceReferenceId,
      evidenceSummary,
    });
  }, [draftLoaded, draftKey, evidenceType, evidenceReferenceId, evidenceSummary, node.masteryEvidenceCandidates.task]);

  function changeEvidenceType(nextType: MasteryEvidenceType) {
    setEvidenceType(nextType);
    setEvidenceReferenceId(node.masteryEvidenceCandidates[nextType][0]?.id ?? "");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReferenceId) return;
    const body: AddMasteryEvidenceBody = {
      evidenceType,
      summary: evidenceSummary.trim() || undefined,
    };
    body[getMasteryEvidenceReferenceKey(evidenceType)] = selectedReferenceId;
    savePrivateBusinessDraft<MasteryEvidenceFormDraft>(draftKey, {
      evidenceType,
      evidenceReferenceId: selectedReferenceId,
      evidenceSummary,
    });
    if (await onAddMasteryEvidence(node.id, body)) {
      removePrivateBusinessDraft(draftKey);
      setEvidenceSummary("");
    }
  }

  return {
    state: { evidenceType, evidenceReferenceId, evidenceSummary, evidenceCandidates, selectedReferenceId },
    actions: { changeEvidenceType, setEvidenceReferenceId, setEvidenceSummary, submit },
  };
}

export type SyllabusEvidenceFormController = ReturnType<typeof useSyllabusEvidenceForm>;

export function useSyllabusRetestForm(
  node: SyllabusTreeNodeProps["node"],
  onAddMasteryRetest: NodeCommands["onAddMasteryRetest"],
) {
  const [result, setResult] = useState<MasteryRetestResult>("passed");
  const [testedAt, setTestedAt] = useState("");
  const [score, setScore] = useState("");
  const [summary, setSummary] = useState("");
  const [nextReviewDate, setNextReviewDate] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const draftKey = syllabusRetestDraftKey(node.id);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(draftKey, SHORT_PRIVATE_DRAFT_TTL_MS, isMasteryRetestFormDraft);
      if (draft) {
        setResult(draft.result);
        setTestedAt(draft.testedAt);
        setScore(draft.score);
        setSummary(draft.summary);
        setNextReviewDate(draft.nextReviewDate);
      }
      setDraftLoaded(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [draftKey]);

  useEffect(() => {
    if (!draftLoaded) return;
    const dirty = result !== "passed" || Boolean(testedAt || score.trim() || summary.trim() || nextReviewDate);
    if (!dirty) {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    savePrivateBusinessDraft<MasteryRetestFormDraft>(draftKey, {
      result,
      testedAt,
      score,
      summary,
      nextReviewDate,
    });
  }, [draftLoaded, draftKey, result, testedAt, score, summary, nextReviewDate]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    savePrivateBusinessDraft<MasteryRetestFormDraft>(draftKey, { result, testedAt, score, summary, nextReviewDate });
    setDateError(null);
    try {
      const body: AddMasteryRetestBody = {
        testedAt: testedAt ? shanghaiDateTimeInputToIso(testedAt) : undefined,
        result,
        score: score.trim() || undefined,
        summary: summary.trim() || undefined,
        nextReviewAt: nextReviewDate ? shanghaiDateInputToIso(nextReviewDate) : null,
      };
      if (await onAddMasteryRetest(node.id, body)) {
        removePrivateBusinessDraft(draftKey);
        setScore("");
        setSummary("");
      }
    } catch (caught) {
      if (!isShanghaiDateInputError(caught)) throw caught;
      setDateError("复测时间或下次复习日期无效，请重新选择。");
    }
  }

  return {
    state: { result, testedAt, score, summary, nextReviewDate, dateError },
    actions: { setResult, setTestedAt, setScore, setSummary, setNextReviewDate, submit },
  };
}

export type SyllabusRetestFormController = ReturnType<typeof useSyllabusRetestForm>;

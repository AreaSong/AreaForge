import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { SimulationExamDto } from "@/lib/contracts";
import {
  buildEditorDraft,
  editorDraftsEqual,
  isSimulationEditorDraft,
  type SimulationEditorDraft,
  type SubjectDraft,
} from "@/components/simulation-detail-drafts";

interface SimulationDraftPersistenceOptions {
  draftKey: string;
  initialExamStatus: SimulationExamDto["status"];
  examStatus: SimulationExamDto["status"];
  examRevision: number;
  summary: string;
  mindset: string;
  reviewText: string;
  subjectDrafts: SubjectDraft[];
  savedBaseline: SimulationEditorDraft;
  draftReady: boolean;
  setSummary: Dispatch<SetStateAction<string>>;
  setMindset: Dispatch<SetStateAction<string>>;
  setReviewText: Dispatch<SetStateAction<string>>;
  setExamRevision: Dispatch<SetStateAction<number>>;
  setSubjectDrafts: Dispatch<SetStateAction<SubjectDraft[]>>;
  setDraftReady: Dispatch<SetStateAction<boolean>>;
}

export function useSimulationDraftPersistence(options: SimulationDraftPersistenceOptions) {
  const {
    draftKey,
    initialExamStatus,
    examStatus,
    examRevision,
    summary,
    mindset,
    reviewText,
    subjectDrafts,
    savedBaseline,
    draftReady,
    setSummary,
    setMindset,
    setReviewText,
    setExamRevision,
    setSubjectDrafts,
    setDraftReady,
  } = options;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (initialExamStatus === "CONFIRMED") {
        removePrivateBusinessDraft(draftKey);
        setDraftReady(true);
        return;
      }
      const saved = loadPrivateBusinessDraft(
        draftKey,
        LONG_PRIVATE_DRAFT_TTL_MS,
        isSimulationEditorDraft,
      );
      if (saved) {
        setSummary(saved.summary);
        setMindset(saved.mindset);
        setReviewText(saved.reviewText ?? "");
        setExamRevision(saved.baseRevision);
        setSubjectDrafts(saved.subjectDrafts);
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey, initialExamStatus, setDraftReady, setExamRevision, setMindset, setReviewText, setSubjectDrafts, setSummary]);

  useEffect(() => {
    if (!draftReady) return;
    if (examStatus === "CONFIRMED") {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    const current = buildEditorDraft(
      examRevision,
      summary,
      mindset,
      reviewText,
      subjectDrafts,
    );
    if (editorDraftsEqual(current, savedBaseline)) {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    savePrivateBusinessDraft(draftKey, current);
  }, [
    draftKey,
    draftReady,
    examRevision,
    examStatus,
    mindset,
    reviewText,
    savedBaseline,
    subjectDrafts,
    summary,
  ]);
}

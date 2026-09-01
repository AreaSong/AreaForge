import { useState } from "react";
import type { FocusEvidenceReceipt, FocusEvidenceType } from "@/components/focus-session-panels";
import { linkFocusSessionEvidence, setFocusEvidenceFlowOpen } from "@/lib/client/focus-evidence";
import { isLocalFocusSessionId } from "@/lib/client/focus-offline-store";
import { archiveNote } from "@/lib/api/notes";
import { archiveMistake } from "@/lib/api/mistakes";
import type { StudySessionDto } from "@/lib/contracts";
import type { FocusPhase } from "@/components/focus-session-draft";

export interface UseFocusEvidenceManagerParams {
  userId: string;
  session: StudySessionDto;
  initialEvidenceReceipts: FocusEvidenceReceipt[];
  setSession: React.Dispatch<React.SetStateAction<StudySessionDto>>;
  setNow: React.Dispatch<React.SetStateAction<Date>>;
  setPhase: React.Dispatch<React.SetStateAction<FocusPhase>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useFocusEvidenceManager(params: UseFocusEvidenceManagerParams) {
  const {
    userId,
    session,
    initialEvidenceReceipts,
    setSession,
    setNow,
    setPhase,
    setError,
  } = params;

  const [activeEvidenceType, setActiveEvidenceType] = useState<FocusEvidenceType>("note");
  const [evidenceReceipts, setEvidenceReceipts] = useState(initialEvidenceReceipts);
  const [editingReceipt, setEditingReceipt] = useState<FocusEvidenceReceipt | null>(null);

  function openEvidenceFlow() {
    if (isLocalFocusSessionId(session.id)) {
      setFocusEvidenceFlowOpen(userId, session.id, true);
      setError("当前收口仍在本机，联网同步后会自动进入证据接力；当前不会伪造服务端证据。");
      setPhase("complete");
      return;
    }
    setFocusEvidenceFlowOpen(userId, session.id, true);
    setPhase("evidence");
  }

  function completeEvidenceFlow() {
    setFocusEvidenceFlowOpen(userId, session.id, false);
    setPhase("complete");
  }

  async function linkEvidence(input: { evidenceType: FocusEvidenceType; evidenceId: string; label: string }) {
    const body = await linkFocusSessionEvidence(session, input);
    setSession(body.session);
    setNow(new Date());
    setEvidenceReceipts((current) =>
      current.some((receipt) => receipt.evidenceType === body.receipt.evidenceType && receipt.evidenceId === body.receipt.evidenceId)
        ? current
        : [...current, body.receipt],
    );
  }

  function handleEditReceipt(receipt: FocusEvidenceReceipt) {
    setEditingReceipt(receipt);
    setActiveEvidenceType(receipt.evidenceType);
  }

  function handleCancelEditEvidence() {
    setEditingReceipt(null);
  }

  function handleUpdateEvidence(updatedReceipt: FocusEvidenceReceipt) {
    setEvidenceReceipts((current) =>
      current.map((r) =>
        r.evidenceId === updatedReceipt.evidenceId && r.evidenceType === updatedReceipt.evidenceType
          ? updatedReceipt
          : r,
      ),
    );
    setEditingReceipt(null);
  }

  async function handleDeleteReceipt(receipt: FocusEvidenceReceipt) {
    try {
      if (receipt.evidenceType === "note") {
        void archiveNote(receipt.evidenceId, { expectedRevision: 1 }).catch(() => undefined);
      } else if (receipt.evidenceType === "mistake") {
        void archiveMistake(receipt.evidenceId, { expectedUpdatedAt: new Date().toISOString() }).catch(() => undefined);
      }
    } catch {
      // Best-effort remote archival
    }

    setEvidenceReceipts((current) => {
      const next = current.filter((r) => r.evidenceId !== receipt.evidenceId);
      const hasRemainingNote = next.some((r) => r.evidenceType === "note");
      const hasRemainingMistake = next.some((r) => r.evidenceType === "mistake");
      setSession((prev) => ({
        ...prev,
        producedNote: hasRemainingNote,
        producedMistake: hasRemainingMistake,
      }));
      return next;
    });

    if (editingReceipt?.evidenceId === receipt.evidenceId) {
      setEditingReceipt(null);
    }
  }

  return {
    activeEvidenceType,
    setActiveEvidenceType,
    evidenceReceipts,
    setEvidenceReceipts,
    editingReceipt,
    setEditingReceipt,
    openEvidenceFlow,
    completeEvidenceFlow,
    linkEvidence,
    handleEditReceipt,
    handleCancelEditEvidence,
    handleUpdateEvidence,
    handleDeleteReceipt,
  };
}

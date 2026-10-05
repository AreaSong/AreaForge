import { useEffect, useRef, useState } from "react";
import type { FocusEvidenceReceipt, FocusEvidenceType } from "@/components/focus-session-panels";
import { archiveFocusEvidence, linkFocusSessionEvidence, setFocusEvidenceFlowOpen } from "@/lib/client/focus-evidence";
import { isLocalFocusSessionId } from "@/lib/client/focus-offline-store";
import { createExclusiveOperationGate } from "@/lib/client/operation-gates";
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
  const archiveGate = useRef(createExclusiveOperationGate());
  const [archiveScope, setArchiveScope] = useState<string | null>(null);
  const scope = `${userId}:${session.id}`;
  const evidencePending = archiveScope === scope;
  useEffect(() => {
    const gate = archiveGate.current;
    return () => gate.invalidate();
  }, [scope]);

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
    if (receipt.evidenceType === "retest") return;
    const token = archiveGate.current.acquire();
    if (!token) return;
    setArchiveScope(scope);
    setError(null);
    const sameReceipt = (item: FocusEvidenceReceipt) => item.evidenceType === receipt.evidenceType && item.evidenceId === receipt.evidenceId;
    try {
      await archiveFocusEvidence(receipt);
      if (!archiveGate.current.isActive(token)) return;
      setEvidenceReceipts((current) => current.filter((item) => !sameReceipt(item)));
      setEditingReceipt((current) => current && sameReceipt(current) ? null : current);
    } catch (error) {
      if (archiveGate.current.isActive(token)) setError(error instanceof Error ? error.message : "归档失败，证据仍保留，请重试。");
    } finally {
      if (archiveGate.current.release(token)) setArchiveScope(null);
    }
  }

  return {
    evidencePending,
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

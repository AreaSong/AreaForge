import Link from "next/link";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { FocusEvidenceForms } from "@/components/focus-evidence-forms";
import {
  CloseoutWorkspace,
  CompleteWorkspace,
  EvidenceWorkspace,
  FocusHeader,
  FocusTimerWorkspace,
  LowConversionWorkspace,
  type CloseoutOutcome,
  type FocusContext,
  type FocusEvidenceReceipt,
  type FocusEvidenceType,
} from "@/components/focus-session-panels";
import { focusPhaseLabel, type FocusCloseoutDraft, type FocusPhase } from "@/components/focus-session-draft";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { formatFocusElapsed } from "@/lib/client/focus-session";
import type { FocusOfflineSyncState } from "@/lib/client/focus-offline-store";
import type { StudySessionDto } from "@/lib/contracts";

export interface FocusSessionConflict {
  latest?: StudySessionDto;
  localSession?: StudySessionDto | null;
  conflictFields: string[];
  action: "start" | "pause" | "resume" | "end" | "context";
  commandId?: string;
  localSessionId?: string;
}

interface FocusSessionWorkspaceProps {
  userId: string;
  activeConflictId: string | null;
  returnTo: string;
  embeddedInWorkbench?: boolean;
  session: StudySessionDto;
  phase: FocusPhase;
  syncState: FocusOfflineSyncState;
  error: string | null;
  elapsedSeconds: number;
  timerLabel: string;
  context: FocusContext;
  outcome: CloseoutOutcome;
  draft: FocusCloseoutDraft;
  closeoutError: string | null;
  commandBusy: boolean;
  submittingCloseout: boolean;
  lowConversionAdded: boolean;
  activeEvidenceType: FocusEvidenceType;
  evidenceReceipts: FocusEvidenceReceipt[];
  editingReceipt?: FocusEvidenceReceipt | null;
  conflict: FocusSessionConflict | null;
  conflictOpen: boolean;
  onRetryDeferredConflict: () => void;
  onPause: () => void;
  onResume: () => void;
  onBeginCloseout: () => void;
  onDraftChange: (draft: FocusCloseoutDraft) => void;
  onClearCloseoutError: () => void;
  onCancelCloseout: () => void;
  onSubmitCloseout: () => void;
  onOpenEvidence: () => void;
  onAddLowConversion: () => void;
  onCompleteEvidence: () => void;
  onEvidenceTypeChange: (type: FocusEvidenceType) => void;
  onLinkEvidence: (input: { evidenceType: FocusEvidenceType; evidenceId: string; label: string }) => Promise<void>;
  onEditReceipt?: (receipt: FocusEvidenceReceipt) => void;
  onDeleteReceipt?: (receipt: FocusEvidenceReceipt) => void;
  onCancelEditEvidence?: () => void;
  onUpdateEvidence?: (receipt: FocusEvidenceReceipt) => Promise<void> | void;
  onOpenConflict: () => void;
  onCloseConflict: () => void;
  onAdoptServer: () => void;
  onManualMerge: () => void;
  onDiscardConflict?: () => void;
}

export function FocusSessionWorkspace(props: FocusSessionWorkspaceProps) {
  if (props.activeConflictId) {
    return (
      <section className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-4 px-4 py-8">
        <h1 className="text-2xl font-semibold text-white">活动冲突</h1>
        <p className="text-sm text-zinc-400">已有其他活动，只能继续当前活动。</p>
        <Link href="/focus" className="text-teal-300 hover:underline">继续当前活动</Link>
      </section>
    );
  }

  const elapsedLabel = formatFocusElapsed(props.elapsedSeconds);
  return (
    <section className={`${props.embeddedInWorkbench ? "h-full min-h-0" : "min-h-full"} w-full bg-[var(--af-canvas)] flex flex-col`}>
      {!props.embeddedInWorkbench ? <FocusHeader returnTo={props.returnTo} status={props.session.status} phaseLabel={focusPhaseLabel(props.phase)} /> : null}
      {props.error ? <div className="px-4 pt-4 sm:px-6 lg:px-8"><Alert tone="danger">{props.error}</Alert></div> : null}
      {props.phase === "focus" && (props.session.status === "running" || props.session.status === "paused") ? (
        <FocusTimerWorkspace
          heading={`开始学习 · ${props.session.subjectName}`}
          elapsedLabel={elapsedLabel}
          elapsedSeconds={props.elapsedSeconds}
          timerLabel={props.timerLabel}
          status={props.session.status}
          commandBusy={props.commandBusy}
          onPause={props.onPause}
          onResume={props.onResume}
          onEnd={props.onBeginCloseout}
          embeddedInWorkbench={props.embeddedInWorkbench}
        />
      ) : null}
      {props.phase === "closeout" ? <FocusCloseout {...props} elapsedLabel={elapsedLabel} /> : null}
      {props.phase === "low-conversion" ? (
        <LowConversionWorkspace
          reason={props.session.antiFakeReason ?? "有效性判定需要补产出。"}
          addedToInbox={props.lowConversionAdded}
          returnTo={props.returnTo}
          onSupplement={props.onOpenEvidence}
          onAddToInbox={props.onAddLowConversion}
          onAccept={props.onCompleteEvidence}
        />
      ) : null}
      {props.phase === "evidence" ? (
        <EvidenceWorkspace
          activeType={props.activeEvidenceType}
          canRetest={Boolean(props.session.syllabusNodeId)}
          receipts={props.evidenceReceipts}
          editingReceiptId={props.editingReceipt?.evidenceId}
          onEditReceipt={props.onEditReceipt}
          onDeleteReceipt={props.onDeleteReceipt}
          onTypeChange={props.onEvidenceTypeChange}
          onComplete={props.onCompleteEvidence}
        >
          <FocusEvidenceForms
            userId={props.userId}
            sessionId={props.session.id}
            subjectId={props.session.subjectId}
            subjectName={props.session.subjectName}
            taskId={props.session.taskId}
            taskTitle={props.session.taskTitle}
            syllabusNodeId={props.session.syllabusNodeId}
            syllabusNodeTitle={props.session.syllabusNodeTitle}
            activeType={props.activeEvidenceType}
            editingReceipt={props.editingReceipt}
            onCancelEdit={props.onCancelEditEvidence}
            onDeleteReceipt={props.onDeleteReceipt}
            onEvidenceSaved={props.onLinkEvidence}
            onEvidenceUpdated={props.onUpdateEvidence}
          />
        </EvidenceWorkspace>
      ) : null}
      {props.phase === "complete" ? (
        <CompleteWorkspace
          elapsedLabel={elapsedLabel}
          lowConversion={props.session.isLowConversion === true}
          taskStatus={props.session.taskStatus}
          returnTo={props.returnTo}
          receipts={props.evidenceReceipts}
        />
      ) : null}
      {props.conflict && !props.conflictOpen ? (
        <Button type="button" variant="ghost" size="sm" className="w-fit text-amber-200 underline" onClick={props.onOpenConflict}>
          {props.conflict.commandId ? "查看离线记录处理方式" : "处理活动状态冲突"}
        </Button>
      ) : null}
      <ConflictResolutionModal
        open={props.conflictOpen && Boolean(props.conflict)}
        title="合并活动状态冲突"
        description="活动已在其他页面或设备变化。系统不会自动重放暂停、继续或结束命令。"
        conflictFields={props.conflict?.conflictFields ?? []}
        comparisons={[
          { field: "status", label: "活动状态", local: props.conflict?.localSession?.status ?? props.session.status, server: props.conflict?.latest?.status },
          { field: "updatedAt", label: "更新时间", local: props.conflict?.localSession?.updatedAt ?? props.session.updatedAt, server: props.conflict?.latest?.updatedAt },
          { field: "closeout", label: "本地收口输入", local: props.draft, server: "服务端不保存未提交草稿" },
        ]}
        onClose={props.onCloseConflict}
        onAdoptServer={props.onAdoptServer}
        onManualMerge={props.onManualMerge}
        onDiscard={props.onDiscardConflict}
        mergeLabel={props.conflict?.commandId ? "保留并稍后对账" : "基于最新状态重建命令"}
        discardLabel="放弃旧离线记录"
      />
    </section>
  );
}

function FocusCloseout(props: FocusSessionWorkspaceProps & { elapsedLabel: string }) {
  const draft = props.draft;
  return (
    <CloseoutWorkspace
      context={props.context}
      elapsedLabel={props.elapsedLabel}
      outcome={props.outcome}
      understandingLevel={draft.understandingLevel}
      lowReasons={draft.lowReasons}
      focusLevel={draft.focusLevel}
      energyLevel={draft.energyLevel}
      minimalOutput={draft.minimalOutput}
      nextAction={draft.nextAction}
      nextDisposition={draft.nextDisposition}
      note={draft.note}
      taskDisposition={draft.taskDisposition}
      validationError={props.closeoutError}
      submitting={props.submittingCloseout}
      onOutcomeChange={(outcome) => props.onDraftChange({
        ...draft,
        isEffective: outcome === "not-achieved" ? "false" : "true",
        qualityScore: outcome === "achieved" ? "4" : outcome === "partial" ? "3" : "1",
        lowReasons: outcome === "not-achieved" ? draft.lowReasons : [],
      })}
      onUnderstandingChange={(understandingLevel) => props.onDraftChange({ ...draft, understandingLevel })}
      onLowReasonsChange={(lowReasons) => { props.onClearCloseoutError(); props.onDraftChange({ ...draft, lowReasons }); }}
      onFocusLevelChange={(focusLevel) => props.onDraftChange({ ...draft, focusLevel })}
      onEnergyLevelChange={(energyLevel) => props.onDraftChange({ ...draft, energyLevel })}
      onMinimalOutputChange={(minimalOutput) => { props.onClearCloseoutError(); props.onDraftChange({ ...draft, minimalOutput }); }}
      onNextActionChange={(nextAction) => { props.onClearCloseoutError(); props.onDraftChange({ ...draft, nextAction }); }}
      onNextDispositionChange={(nextDisposition) => props.onDraftChange({ ...draft, nextDisposition })}
      onNoteChange={(note) => props.onDraftChange({ ...draft, note })}
      onTaskDispositionChange={(taskDisposition) => props.onDraftChange({
        ...draft,
        taskDisposition,
        nextAction: taskDisposition === "complete" ? "转入下一项" : "",
      })}
      onCancel={props.onCancelCloseout}
      onSubmit={props.onSubmitCloseout}
    />
  );
}

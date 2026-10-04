import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { conflictComparisons, type MistakeConflict, type MistakeEditDraft } from "@/components/mistake-detail-support";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Alert } from "@/components/ui/feedback";
import type { MistakeDto } from "@/lib/contracts";

interface MistakeDetailDialogState {
  notice: string | null;
  error: string | null;
  conflict: MistakeConflict | null;
  conflictOpen: boolean;
  confirmation: "archive" | "discard" | null;
  pending: boolean;
}

interface MistakeDetailDialogActions {
  openConflict: () => void;
  closeConflict: () => void;
  closeConfirmation: () => void;
  archive: () => void;
  discard: () => void;
  adoptLatest: () => void;
  mergeOntoLatest: () => void;
}

export function MistakeDetailDialogs({
  state,
  localEdit,
  mistake,
  actions,
}: {
  state: MistakeDetailDialogState;
  localEdit: MistakeEditDraft;
  mistake: MistakeDto;
  actions: MistakeDetailDialogActions;
}) {
  return (
    <>
      {state.notice ? <Alert tone="success">{state.notice}</Alert> : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.conflict && !state.conflictOpen ? (
        <Button type="button" variant="ghost" size="sm" className="text-amber-200 underline" onClick={actions.openConflict}>
          处理错题状态冲突
        </Button>
      ) : null}
      <ConfirmationDialog
        open={state.confirmation !== null}
        title={state.confirmation === "archive" ? "归档这道错题？" : "放弃本机编辑？"}
        description={state.confirmation === "archive"
          ? "归档后错题变为只读，活动复习排期会暂停。恢复错题不会自动恢复排期。"
          : "当前未提交的错因、题面和正确思路会被清除，服务端已保存内容不会改变。"}
        confirmLabel={state.confirmation === "archive" ? "确认归档" : "放弃并清除草稿"}
        pending={state.pending && state.confirmation === "archive"}
        pendingLabel="正在归档"
        onClose={actions.closeConfirmation}
        onConfirm={() => {
          if (state.confirmation === "archive") {
            actions.closeConfirmation();
            actions.archive();
          } else {
            actions.discard();
            actions.closeConfirmation();
          }
        }}
      />
      <ConflictResolutionModal
        open={state.conflictOpen && Boolean(state.conflict)}
        title="处理错题状态冲突"
        description="服务端错题已变化。本地作答与编辑草稿仍保留，系统不会强制覆盖或自动重放。"
        conflictFields={state.conflict?.conflictFields ?? []}
        comparisons={conflictComparisons(localEdit, mistake, state.conflict?.latest)}
        onClose={actions.closeConflict}
        onAdoptServer={actions.adoptLatest}
        onManualMerge={actions.mergeOntoLatest}
        mergeLabel="保留本地输入并采用最新基线"
      />
    </>
  );
}

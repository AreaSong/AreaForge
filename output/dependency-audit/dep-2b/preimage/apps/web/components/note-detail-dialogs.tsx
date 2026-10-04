import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  buildConflictComparisons,
  type NoteConflict,
  type NoteDetailDraft,
} from "@/components/note-detail-support";

interface NoteDetailDialogState {
  conflict: NoteConflict | null;
  conflictOpen: boolean;
  confirmation: "archive" | "discard" | null;
  archivePending: boolean;
}

interface NoteDetailDialogActions {
  closeConflict: () => void;
  adoptServerVersion: () => void;
  mergeOntoLatest: () => void;
  closeConfirmation: () => void;
  archive: () => void;
  discardDraft: () => void;
}

export function NoteDetailDialogs({
  state,
  baseline,
  draft,
  actions,
}: {
  state: NoteDetailDialogState;
  baseline: NoteDetailDraft;
  draft: NoteDetailDraft;
  actions: NoteDetailDialogActions;
}) {
  return (
    <>
      <ConflictResolutionModal
        open={state.conflictOpen && Boolean(state.conflict)}
        title="处理卡片版本冲突"
        description="服务端卡片已变化。本地草稿仍保留，系统不会强制覆盖或自动重放。"
        conflictFields={state.conflict?.conflictFields ?? []}
        comparisons={buildConflictComparisons(baseline, draft, state.conflict?.latest)}
        onClose={actions.closeConflict}
        onAdoptServer={actions.adoptServerVersion}
        onManualMerge={actions.mergeOntoLatest}
        mergeLabel={state.conflict?.intent === "save" ? "保留本地并基于最新版本" : "更新基线后手动重试"}
      />
      <ConfirmationDialog
        open={state.confirmation !== null}
        title={state.confirmation === "archive" ? "归档这张卡片？" : "放弃本机编辑？"}
        description={state.confirmation === "archive"
          ? "归档后卡片变为只读，活动复习排期会暂停。恢复卡片不会自动恢复排期。"
          : "当前未提交内容和本机草稿会被清除，服务端已保存内容不会改变。"}
        confirmLabel={state.confirmation === "archive" ? "确认归档" : "放弃并清除草稿"}
        pending={state.archivePending}
        pendingLabel="正在归档"
        onClose={actions.closeConfirmation}
        onConfirm={() => {
          if (state.confirmation === "archive") {
            actions.closeConfirmation();
            actions.archive();
            return;
          }
          actions.discardDraft();
          actions.closeConfirmation();
        }}
      />
    </>
  );
}

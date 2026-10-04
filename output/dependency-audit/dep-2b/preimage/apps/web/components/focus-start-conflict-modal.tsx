"use client";

import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import type { StudySessionDto } from "@/lib/contracts";

export interface FocusStartConflict {
  localSession: StudySessionDto;
  latest: StudySessionDto | null;
  commandId: string;
  localSessionId: string;
  conflictFields: string[];
}

export function FocusStartConflictModal(props: {
  conflict: FocusStartConflict | null;
  open: boolean;
  onClose: () => void;
  onAdopt: () => void;
  onRetry: () => void;
}) {
  const conflict = props.conflict;
  return (
    <ConflictResolutionModal
      open={props.open && Boolean(conflict)}
      title="处理开始学习冲突"
      description="服务端已有活动学习。系统不会自动切换活动，也不会自动重放新的开始命令。"
      conflictFields={conflict?.conflictFields ?? []}
      comparisons={conflict ? [
        { field: "status", label: "本地开始记录", local: conflict.localSession.status, server: conflict.latest?.status ?? "无服务端版本" },
        { field: "subject", label: "科目", local: conflict.localSession.subjectName, server: conflict.latest?.subjectName ?? "无服务端版本" },
        { field: "updatedAt", label: "更新时间", local: conflict.localSession.updatedAt, server: conflict.latest?.updatedAt ?? "无服务端版本" },
      ] : []}
      onClose={props.onClose}
      onAdoptServer={props.onAdopt}
      onManualMerge={props.onRetry}
      adoptLabel="采用当前活动"
      mergeLabel="保留命令并重试"
    />
  );
}

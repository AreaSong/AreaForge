"use client";

import { BookOpenCheck } from "lucide-react";
import { SyllabusRetestForm } from "@/components/syllabus-retest-form";
import { Alert } from "@/components/ui/feedback";
import type { FocusEvidenceReceipt, FocusEvidenceType } from "@/components/focus-session-evidence";
import {
  type EvidenceContext,
  EvidenceHeading,
} from "./focus-evidence-form-helpers";
import { FocusNoteForm } from "./focus-evidence-note-form";
import { FocusMistakeForm } from "./focus-evidence-mistake-form";

export {
  type EvidenceContext,
  EvidenceHeading,
  FocusNoteForm,
  FocusMistakeForm,
};

export function FocusEvidenceForms(props: EvidenceContext & {
  activeType: FocusEvidenceType;
  editingReceipt?: FocusEvidenceReceipt | null;
  onCancelEdit?: () => void;
  onDeleteReceipt?: (receipt: FocusEvidenceReceipt) => void;
  onEvidenceSaved: (input: { evidenceType: FocusEvidenceType; evidenceId: string; label: string }) => Promise<void>;
  onEvidenceUpdated?: (receipt: FocusEvidenceReceipt) => Promise<void> | void;
}) {
  if (props.activeType === "note") return <FocusNoteForm {...props} />;
  if (props.activeType === "mistake") return <FocusMistakeForm {...props} />;
  if (!props.syllabusNodeId) return <Alert tone="warning">本次学习没有关联考纲节点，无法记录复测。</Alert>;
  return (
    <div>
      <EvidenceHeading icon={<BookOpenCheck />} title="记录复测" context={props.syllabusNodeTitle} />
      <SyllabusRetestForm
        compact
        nodeId={props.syllabusNodeId}
        draftScope={`${props.syllabusNodeId}.focus.${props.sessionId}`}
        commandScope={`mastery-retest:${props.syllabusNodeId}:focus:${props.sessionId}`}
        onCancel={() => undefined}
        onSaved={async ({ retestId }) => {
          if (!retestId) throw new Error("复测已经保存，但服务端没有返回回写标识；请保留当前页面并显式重试。");
          await props.onEvidenceSaved({ evidenceType: "retest", evidenceId: retestId, label: "复测记录" });
        }}
      />
    </div>
  );
}

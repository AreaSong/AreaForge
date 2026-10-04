import type { MotivationItemType, MotivationRecoveryAction } from "@areaforge/core";
import type { MistakeCauseDto, MistakeDto } from "./mistake";
import type { NoteDto } from "./note";
import type { TaskStatusDto } from "./task";

export interface OwnedMistakeDetailDto {
  mistake: MistakeDto;
  readOnly: boolean;
  subjectArchived: boolean;
  workspaceName: string;
}

export interface MistakeCreatePrefillDto {
  simulationLossItemId: string;
  linkedMistakeId: string | null;
  subjectId: string;
  syllabusNodeId: string | null;
  title: string;
  questionText: string;
  source: string;
  cause: Exclude<MistakeCauseDto, "unknown">;
  causeNote: string;
}

export interface MotivationItemDto {
  id: string;
  type: MotivationItemType;
  title: string;
  body: string | null;
  externalUrl: string | null;
  vaultSourceId: string | null;
  tags: string[];
  enabled: boolean;
  sortOrder: number;
  revision: number;
  archivedAt: string | null;
  updatedAt: string;
}

export interface MotivationNextDto {
  item: MotivationItemDto | null;
  recoveryActions: MotivationRecoveryAction[];
  reminderAllowed: boolean;
  reminderReason: "manual" | "ok" | "interval" | "daily_cap" | "empty" | "active_activity" | "no_trigger";
}

export type MotivationVaultField =
  | "whyStarted"
  | "neverReturnTo"
  | "futureSelf"
  | "messageToFuture"
  | "firstSimulationDiary";

export interface NoteEditorOptionsDto {
  subjects: Array<{ id: string; name: string; archivedAt: string | null }>;
  tasks: Array<{ id: string; subjectId: string; title: string; status: TaskStatusDto }>;
  syllabusNodes: Array<{ id: string; subjectId: string; title: string; archivedAt: string | null }>;
  resources: Array<{ id: string; title: string; archivedAt: string | null }>;
}

export interface OwnedNoteDetailDto {
  note: NoteDto;
  readOnly: boolean;
  subjectArchived: boolean;
  workspaceName: string;
}

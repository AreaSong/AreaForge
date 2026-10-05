import { getNote } from "@/lib/api/notes";

export interface FocusNoteBaseline { context: string; revision: number }

export function canSaveFocusNote(context: string, baseline: FocusNoteBaseline | null): boolean {
  return baseline?.context === context && Number.isInteger(baseline.revision) && baseline.revision > 0;
}

export async function loadEditableFocusNote(id: string, read = getNote) {
  const res = await read(id);
  const note = res.body?.note;
  if (!res.ok || !note || note.id !== id || !Number.isInteger(note.revision)
    || note.revision < 1 || res.body?.readOnly || res.body?.subjectArchived) {
    throw new Error("获取知识卡片详情失败或当前不可编辑，请重试。");
  }
  return note;
}

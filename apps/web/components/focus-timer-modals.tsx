import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { CornerDownLeft, Square, StickyNote, X } from "lucide-react";
import { forwardRef } from "react";

export interface FocusScratchpadProps {
  noteInput: string;
  savedNotes: string[];
  onNoteInputChange: (val: string) => void;
  onSaveNote: () => void;
  onDeleteNote: (idx: number) => void;
  onClose: () => void;
}

export const FocusScratchpad = forwardRef<HTMLInputElement, FocusScratchpadProps>(
  function FocusScratchpad(
    {
      noteInput,
      savedNotes,
      onNoteInputChange,
      onSaveNote,
      onDeleteNote,
      onClose,
    },
    ref,
  ) {
    return (
      <div className="mt-5 w-full max-w-md animate-[fade-in-up_0.2s_ease-out] rounded-xl border border-teal-500/30 bg-[#0d1417] p-3 shadow-2xl">
        <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs text-zinc-400">
          <span className="flex items-center gap-1 text-teal-300 font-medium">
            <StickyNote className="size-3.5" /> 闪念随手记（不打断专注）
          </span>
          <Button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 hover:bg-white/10 hover:text-white"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Input
            ref={ref}
            type="text"
            value={noteInput}
            onChange={(e) => onNoteInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveNote();
            }}
            placeholder="记下突发想法，回车即存..."
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-teal-400 focus:outline-none"
          />
          <Button
            type="button"
            onClick={onSaveNote}
            className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-teal-400 transition-colors"
          >
            <CornerDownLeft className="size-3" />
            <span>存</span>
          </Button>
        </div>
        {savedNotes.length > 0 ? (
          <ul className="mt-2.5 max-h-24 overflow-y-auto space-y-1 text-left focus-scrollbar">
            {savedNotes.map((note, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between text-[11px] text-zinc-300 bg-white/5 rounded px-2 py-1"
              >
                <span className="truncate pr-2">• {note}</span>
                <Button
                  type="button"
                  onClick={() => onDeleteNote(idx)}
                  className="text-zinc-500 hover:text-red-400 shrink-0"
                >
                  <X className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  },
);

export function FocusConfirmEndModal(props: {
  elapsedLabel: string;
  commandBusy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-[fade-in_0.15s_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-end-title"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-white/15 bg-[#0f1519] p-6 shadow-2xl animate-[scale-in_0.2s_cubic-bezier(0.16,1,0.3,1)] text-left">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-teal-500/30 bg-teal-500/10 text-teal-300">
            <Square className="size-5 fill-current" aria-hidden="true" />
          </div>
          <div>
            <h2 id="confirm-end-title" className="text-lg font-semibold text-white">
              结束本次专注？
            </h2>
            <p className="text-xs text-zinc-400">
              当前已专注 <span className="font-mono font-semibold text-teal-300">{props.elapsedLabel}</span> · 计时已自动暂停
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-zinc-300">
          结束计时后将冻结本次学习时长，并进入收口成果沉淀与复盘环节。
        </p>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-white/10 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={props.onCancel}
          >
            继续专注
          </Button>
          <Button
            type="button"
            variant="primary"
            autoFocus
            disabled={props.commandBusy}
            onClick={props.onConfirm}
          >
            确认结束
          </Button>
        </div>
      </div>
    </div>
  );
}

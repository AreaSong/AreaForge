import type { ReactNode, RefObject } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";

export function ConfirmationDialog(props: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  pendingLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Modal
      open={props.open}
      title={props.title}
      onClose={props.pending ? undefined : props.onClose}
      allowEscape={!props.pending}
      returnFocusRef={props.returnFocusRef}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 text-sm leading-6 text-zinc-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
          <div>{props.description}</div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={props.pending} onClick={props.onClose}>
            取消
          </Button>
          <Button
            type="button"
            variant="danger"
            className="w-full sm:w-auto"
            loading={props.pending}
            loadingLabel={props.pendingLabel ?? "处理中"}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

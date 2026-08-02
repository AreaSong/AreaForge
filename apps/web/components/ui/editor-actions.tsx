import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function EditorActionBar(props: {
  primaryLabel: string;
  primaryIcon?: ReactNode;
  primaryType?: "button" | "submit";
  primaryDisabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  secondaryIcon?: ReactNode;
  secondaryDisabled?: boolean;
  onSecondary?: () => void;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-xs leading-5 text-zinc-500">{props.hint}</div>
      <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
        {props.secondaryLabel && props.onSecondary ? (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full sm:w-auto"
            disabled={props.secondaryDisabled || props.loading}
            onClick={props.onSecondary}
          >
            {props.secondaryIcon}
            {props.secondaryLabel}
          </Button>
        ) : null}
        <Button
          type={props.primaryType ?? "button"}
          variant="primary"
          size="lg"
          className="w-full sm:w-auto"
          disabled={props.primaryDisabled}
          loading={props.loading}
          loadingLabel={props.loadingLabel ?? "正在保存到服务端"}
          onClick={props.onPrimary}
        >
          {props.primaryIcon}
          {props.primaryLabel}
        </Button>
      </div>
    </div>
  );
}

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ColorSwatches(props: {
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${props.className ?? ""}`.trim()} role="group" aria-label={props.label ?? "颜色"}>
      {props.colors.map((color) => (
        <Button
          key={color}
          type="button"
          disabled={props.disabled}
          className="relative h-7 w-7 rounded-md border border-white/20"
          style={{ backgroundColor: color }}
          aria-label={`选择颜色 ${color}`}
          aria-pressed={props.value === color}
          onClick={() => props.onChange(color)}
        >
          {props.value === color ? <Check className="absolute inset-0 m-auto text-black" size={15} aria-hidden="true" /> : null}
        </Button>
      ))}
    </div>
  );
}


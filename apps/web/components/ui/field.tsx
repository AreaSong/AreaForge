import type { ComponentProps, ReactNode } from "react";

export type InputProps = ComponentProps<"input">;
export type SelectProps = ComponentProps<"select">;
export type CheckboxProps = Omit<ComponentProps<"input">, "type">;
export type RadioProps = Omit<ComponentProps<"input">, "type">;
export type TextareaProps = ComponentProps<"textarea"> & {
  controlHeight?: "sm" | "md" | "lg";
};

const textareaHeightClass: Record<NonNullable<TextareaProps["controlHeight"]>, string> = {
  sm: "min-h-20",
  md: "min-h-24",
  lg: "min-h-32",
};

const defaultControlHeightClass = "af-control-height-md";

const controlClassName = [
  "w-full min-w-0 rounded-[var(--af-radius-control)] border border-[var(--af-border)] bg-[var(--af-surface-raised)] px-3 text-sm text-[var(--af-text-primary)]",
  "outline-none transition-colors placeholder:text-zinc-600",
  "focus:border-teal-400/50 focus:ring-2 focus:ring-teal-400/15",
  "aria-invalid:border-red-400/60 aria-invalid:focus:border-red-400/70 aria-invalid:focus:ring-red-400/15",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

export function Field(props: {
  label: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`grid min-w-0 gap-2 ${props.className ?? ""}`}>
      <label htmlFor={props.htmlFor} className="text-sm text-zinc-300">
        {props.label}
        {props.required ? <span className="ml-1 text-amber-300" aria-hidden="true">*</span> : null}
      </label>
      {props.description ? <p className="text-xs leading-5 text-zinc-500">{props.description}</p> : null}
      <div className="min-w-0">{props.children}</div>
      {props.error ? <p className="text-xs leading-5 text-red-200" role="alert">{props.error}</p> : null}
    </div>
  );
}

export function formControlClassName(className = ""): string {
  return `${controlClassName} ${className}`.trim();
}

export function Input({ className, ...props }: InputProps) {
  return <input {...props} className={`${formControlClassName()} ${defaultControlHeightClass} ${className ?? ""}`} />;
}

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <input
      {...props}
      type="checkbox"
      className={`h-4 w-4 shrink-0 rounded border-[var(--af-border-strong)] bg-[var(--af-surface-raised)] accent-[var(--af-accent)] ${className ?? ""}`}
    />
  );
}

export function Radio({ className, ...props }: RadioProps) {
  return (
    <input
      {...props}
      type="radio"
      className={`h-4 w-4 shrink-0 rounded-full border-[var(--af-border-strong)] bg-[var(--af-surface-raised)] accent-[var(--af-accent)] ${className ?? ""}`}
    />
  );
}

export function Select({ className, ...props }: SelectProps) {
  return <select {...props} className={`${formControlClassName()} ${defaultControlHeightClass} ${className ?? ""}`} />;
}

export function Textarea({ className, controlHeight = "md", ...props }: TextareaProps) {
  return <textarea {...props} className={`${formControlClassName()} ${textareaHeightClass[controlHeight]} resize-y py-2 ${className ?? ""}`} />;
}

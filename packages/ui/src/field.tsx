import React, { type ComponentProps, type ReactNode } from "react";

export type ControlHeight = "sm" | "md" | "lg" | "xl";
export type TextareaControlHeight = "sm" | "md" | "lg";

export const controlHeightClasses: Record<ControlHeight, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-3.5 text-sm",
  lg: "h-11 px-4 text-sm",
  xl: "h-12 px-4 text-base",
};

export const textareaHeightClasses: Record<TextareaControlHeight, string> = {
  sm: "min-h-20",
  md: "min-h-24",
  lg: "min-h-32",
};

export const baseControlClasses =
  "w-full min-w-0 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400/20 aria-invalid:border-rose-400/60 aria-invalid:focus:border-rose-400/70 aria-invalid:focus:ring-rose-400/15 disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

export interface FormControlClassNameOptions {
  className?: string;
  controlHeight?: ControlHeight;
  invalid?: boolean;
}

export function formControlClassName(
  classNameOrOptions?: string | FormControlClassNameOptions,
): string {
  if (typeof classNameOrOptions === "string") {
    return `${baseControlClasses} ${classNameOrOptions}`.trim().replace(/\s+/g, " ");
  }
  const { className, controlHeight, invalid } = classNameOrOptions ?? {};
  const heightClass = controlHeight ? controlHeightClasses[controlHeight] : "";
  const invalidClass = invalid
    ? "border-rose-400/60 focus:border-rose-400/70 focus:ring-rose-400/15"
    : "";
  return `${baseControlClasses} ${heightClass} ${invalidClass} ${className ?? ""}`
    .trim()
    .replace(/\s+/g, " ");
}

export function inputClassName(options?: FormControlClassNameOptions): string {
  const height = options?.controlHeight ?? "md";
  return formControlClassName({
    ...options,
    controlHeight: height,
  });
}

export function selectClassName(options?: FormControlClassNameOptions): string {
  const height = options?.controlHeight ?? "md";
  const custom = `[&>option]:bg-[#0e1619] [&>option]:text-white ${options?.className ?? ""}`;
  return formControlClassName({
    ...options,
    className: custom,
    controlHeight: height,
  });
}

export function textareaClassName(options?: {
  controlHeight?: TextareaControlHeight;
  className?: string;
  invalid?: boolean;
}): string {
  const height = options?.controlHeight ?? "md";
  const heightClass = textareaHeightClasses[height];
  const invalidClass = options?.invalid
    ? "border-rose-400/60 focus:border-rose-400/70 focus:ring-rose-400/15"
    : "";
  return `${baseControlClasses} ${heightClass} resize-y p-3 text-sm ${invalidClass} ${options?.className ?? ""}`
    .trim()
    .replace(/\s+/g, " ");
}

export function checkboxClassName(className = ""): string {
  return `h-4 w-4 shrink-0 rounded border border-white/20 bg-white/5 text-teal-400 accent-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-50 transition-colors ${className}`
    .trim()
    .replace(/\s+/g, " ");
}

export function radioClassName(className = ""): string {
  return `h-4 w-4 shrink-0 rounded-full border border-white/20 bg-white/5 text-teal-400 accent-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-50 transition-colors ${className}`
    .trim()
    .replace(/\s+/g, " ");
}

export function fieldClassName(className = ""): string {
  return `grid min-w-0 gap-2 ${className}`.trim().replace(/\s+/g, " ");
}

export type InputProps = ComponentProps<"input"> & {
  controlHeight?: ControlHeight;
};

export type SelectProps = ComponentProps<"select"> & {
  controlHeight?: ControlHeight;
};

export type TextareaProps = ComponentProps<"textarea"> & {
  controlHeight?: TextareaControlHeight;
};

export type CheckboxProps = Omit<ComponentProps<"input">, "type">;

export type RadioProps = Omit<ComponentProps<"input">, "type">;

export interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
}

export type FormFieldProps = FieldProps;

export function Input({ className, controlHeight = "md", ...props }: InputProps) {
  return (
    <input
      {...props}
      className={inputClassName({ controlHeight, className })}
    />
  );
}

export function Select({ className, controlHeight = "md", ...props }: SelectProps) {
  return (
    <select
      {...props}
      className={selectClassName({ controlHeight, className })}
    />
  );
}

export function Textarea({
  className,
  controlHeight = "md",
  ...props
}: TextareaProps) {
  return (
    <textarea
      {...props}
      className={textareaClassName({ controlHeight, className })}
    />
  );
}

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <input
      {...props}
      type="checkbox"
      className={checkboxClassName(className)}
    />
  );
}

export function Radio({ className, ...props }: RadioProps) {
  return (
    <input
      {...props}
      type="radio"
      className={radioClassName(className)}
    />
  );
}

export function Field({
  label,
  children,
  htmlFor,
  description,
  hint,
  error,
  required,
  className,
}: FieldProps) {
  const descContent = description ?? hint;
  return (
    <div className={fieldClassName(className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-zinc-300">
        {label}
        {required ? (
          <span className="ml-1 text-amber-300" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {descContent ? (
        <p className="text-xs leading-5 text-zinc-500">{descContent}</p>
      ) : null}
      <div className="min-w-0">{children}</div>
      {error ? (
        <p className="text-xs leading-5 text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const FormField = Field;

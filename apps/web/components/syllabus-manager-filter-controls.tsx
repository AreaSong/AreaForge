import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";

export function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <dl><Metric label={label} value={value} layout="compact" valueSize="lg" className="px-0" /></dl>;
}

interface FilterButtonProps {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}

export function MapStatusButton({ active, count, label, onClick }: FilterButtonProps) {
  return (
    <Button
      className={`rounded-md border px-3 py-2 text-left text-sm transition ${
        active
          ? "border-amber-300/45 bg-amber-300/15 text-amber-50"
          : "border-[var(--af-border)] bg-[var(--af-surface-raised)] text-zinc-300 hover:bg-white/10"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="block text-xs opacity-70">{label}</span>
      <span className="mt-1 block text-lg font-semibold">{count}</span>
    </Button>
  );
}

export function StatusFilterButton({ active, count, label, onClick }: FilterButtonProps) {
  return (
    <Button
      className={`rounded-md border px-3 py-2 text-left text-sm transition ${
        active
          ? "border-teal-300/40 bg-teal-300/15 text-teal-50"
          : "border-[var(--af-border)] bg-[var(--af-surface-raised)] text-zinc-300 hover:bg-white/10"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="block text-xs opacity-70">{label}</span>
      <span className="mt-1 block text-lg font-semibold">{count}</span>
    </Button>
  );
}

export function ActionFilterButton({ active, count, label, onClick }: FilterButtonProps) {
  return (
    <Button
      className={`rounded-md border px-3 py-2 text-left text-sm transition ${
        active
          ? "border-sky-300/45 bg-sky-300/15 text-sky-50"
          : "border-[var(--af-border)] bg-[var(--af-surface-raised)] text-zinc-300 hover:bg-white/10"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="block text-xs opacity-70">{label}</span>
      <span className="mt-1 block text-lg font-semibold">{count}</span>
    </Button>
  );
}

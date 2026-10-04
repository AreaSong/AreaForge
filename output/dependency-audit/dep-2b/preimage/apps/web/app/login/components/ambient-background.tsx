import type { CSSProperties } from "react";

const gridStyle: CSSProperties = {
  backgroundImage:
    "linear-gradient(rgba(94, 234, 212, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(94, 234, 212, 0.045) 1px, transparent 1px)",
  backgroundSize: "44px 44px",
  WebkitMaskImage: "radial-gradient(ellipse at 42% 42%, black 12%, transparent 72%)",
  maskImage: "radial-gradient(ellipse at 42% 42%, black 12%, transparent 72%)",
};

export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_12%,rgba(20,184,166,0.10),transparent_32%),radial-gradient(circle_at_78%_55%,rgba(45,212,191,0.06),transparent_30%),linear-gradient(145deg,#07100f_0%,#090b0e_52%,#07100f_100%)]" />
      <div className="absolute inset-0 opacity-80" style={gridStyle} />
      <div className="af-login-ambient-glow absolute left-[8%] top-[14%] size-[34rem] rounded-full bg-teal-300/[0.06] blur-[120px]" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/30 to-transparent" />
      <div className="absolute left-[14%] top-[22%] size-1 rounded-full bg-teal-200/30" />
      <div className="absolute left-[57%] top-[12%] size-1 rounded-full bg-teal-200/20" />
      <div className="absolute bottom-[18%] right-[9%] size-1 rounded-full bg-teal-200/25" />
    </div>
  );
}

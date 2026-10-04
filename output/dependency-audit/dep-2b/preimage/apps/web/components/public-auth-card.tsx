import Image from "next/image";
import type { ReactNode } from "react";

export function PublicAuthCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#07100f] px-4 py-10 text-zinc-100">
      <div className="w-full max-w-md rounded-[1.75rem] border border-white/10 bg-[#121817]/95 p-6 shadow-2xl sm:p-8">
        <Image alt="AreaForge" className="h-8 w-auto" height={98} src="/brand/areaforge-logo-lockup.svg" width={300} />
        <h1 className="mt-8 text-2xl font-semibold text-white">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

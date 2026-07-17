function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-white/[0.08] ${className}`} />;
}

export default function Loading() {
  return (
    <main className="min-h-screen bg-[#080b0f] px-4 py-5 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-10 w-56 max-w-full" />
            <Skeleton className="h-4 w-44" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Skeleton className="h-16 w-full sm:w-28" />
            <Skeleton className="h-16 w-full sm:w-28" />
            <Skeleton className="h-16 w-full sm:w-28" />
            <Skeleton className="h-16 w-full sm:w-28" />
            <Skeleton className="h-16 w-full sm:w-28" />
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="min-h-[28rem] rounded-lg border border-white/10 bg-[#101419] p-5">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-9 w-24" />
            </div>
            <Skeleton className="mx-auto mt-12 h-36 w-36 rounded-full" />
            <div className="mt-12 flex justify-center gap-3">
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-10 w-28" />
            </div>
            <div className="mt-8 grid grid-cols-3 gap-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
          <div className="min-h-[28rem] rounded-lg border border-white/10 bg-[#101419] p-5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-4 h-20 w-full" />
            <Skeleton className="mt-6 h-28 w-full" />
            <Skeleton className="mt-6 h-20 w-full" />
          </div>
        </section>
      </div>
    </main>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function useSyllabusCommandRuntime() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return {
    error,
    setError,
    pendingCommand,
    setPendingCommand,
    isPending,
    push: router.push,
    replace: router.replace,
    refresh() {
      startTransition(() => router.refresh());
    },
  };
}

export type SyllabusCommandRuntime = ReturnType<typeof useSyllabusCommandRuntime>;

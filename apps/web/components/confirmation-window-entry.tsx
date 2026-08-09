"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useWindowSystem } from "@/components/window-system";

export function ConfirmationWindowEntry(props: {
  filter: "pending" | "history";
  confirmationId?: string;
  returnTo: string;
}) {
  const router = useRouter();
  const { foregroundKey } = useWindowSystem();

  useEffect(() => {
    if (foregroundKey !== "confirmation-center") return;
    router.replace(props.returnTo);
  }, [foregroundKey, props.returnTo, router]);

  return null;
}

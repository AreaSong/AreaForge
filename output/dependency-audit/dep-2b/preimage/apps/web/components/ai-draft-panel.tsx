"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { WindowWorkState } from "@/lib/client/window-system-state";
import { AiDraftPanelView } from "@/components/ai-draft-panel-view";
import type { AiDraftEndpoint as Endpoint } from "@/components/ai-draft-panel-model";
import { useAiDraftWorkflow } from "@/components/use-ai-draft-workflow";

export function AiDraftPanel(props: {
  endpoint: Endpoint;
  userId: string;
  defaultText?: string;
  draftContextKey?: string;
  onWorkStateChange?: (state: WindowWorkState) => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeContextKey = `${pathname}?${searchParams.toString()}`;
  const workflow = useAiDraftWorkflow({ ...props, routeContextKey });
  return <AiDraftPanelView {...workflow} />;
}

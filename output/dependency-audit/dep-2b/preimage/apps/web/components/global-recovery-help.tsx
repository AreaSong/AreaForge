"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useGlobalTools } from "@/components/global-tool-system";
import { RecoveryActionContent } from "@/components/recovery-action-drawer";

export function GlobalRecoveryHelp(props: {
  title: string;
  motivationLine: string | null;
  motivationUrl: string | null;
  motivationError: string | null;
  workspaceId: string | null;
  defaultSubjectId: string | null;
}) {
  const { registerTool, refreshTool, closeTool } = useGlobalTools();
  const { title, motivationLine, motivationUrl, motivationError, workspaceId, defaultSubjectId } = props;
  const closeRecoveryHelp = useCallback(() => {
    closeTool();
  }, [closeTool]);
  const content = useMemo(() => <RecoveryActionContent open title={title} motivationLine={motivationLine} motivationUrl={motivationUrl} motivationError={motivationError} workspaceId={workspaceId} defaultSubjectId={defaultSubjectId} onClose={closeRecoveryHelp} />, [closeRecoveryHelp, defaultSubjectId, motivationError, motivationLine, motivationUrl, title, workspaceId]);
  const contentRef = useRef<React.ReactNode>(content);

  useEffect(() => registerTool({
    key: "recovery-help",
    title,
    size: "medium",
    render: () => contentRef.current,
  }), [registerTool, title]);

  useEffect(() => {
    contentRef.current = content;
    refreshTool("recovery-help");
  }, [content, refreshTool]);

  return null;
}

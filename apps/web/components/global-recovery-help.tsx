"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { RecoveryActionContent } from "@/components/recovery-action-drawer";
import { useWindowSystem } from "@/components/window-system";

export function GlobalRecoveryHelp(props: {
  title: string;
  motivationLine: string | null;
  motivationUrl: string | null;
  motivationError: string | null;
  workspaceId: string | null;
  defaultSubjectId: string | null;
}) {
  const { registerWindow, refreshWindow, updateWindowMetadata, requestCloseWindow } = useWindowSystem();
  const { title, motivationLine, motivationUrl, motivationError, workspaceId, defaultSubjectId } = props;
  const closeRecoveryHelp = useCallback(() => {
    requestCloseWindow("recovery-help");
  }, [requestCloseWindow]);
  const content = useMemo(() => <RecoveryActionContent open title={title} motivationLine={motivationLine} motivationUrl={motivationUrl} motivationError={motivationError} workspaceId={workspaceId} defaultSubjectId={defaultSubjectId} onClose={closeRecoveryHelp} />, [closeRecoveryHelp, defaultSubjectId, motivationError, motivationLine, motivationUrl, title, workspaceId]);
  const contentRef = useRef<React.ReactNode>(content);

  useEffect(() => registerWindow({
    key: "recovery-help",
    kind: "recovery-help",
    title: "我学不下去了",
    closePolicy: "free",
    render: () => contentRef.current,
  }), [registerWindow]);

  useEffect(() => {
    contentRef.current = content;
    refreshWindow("recovery-help");
  }, [content, refreshWindow]);

  useEffect(() => {
    updateWindowMetadata("recovery-help", { kind: "recovery-help", title, closePolicy: "free" });
  }, [title, updateWindowMetadata]);

  return null;
}

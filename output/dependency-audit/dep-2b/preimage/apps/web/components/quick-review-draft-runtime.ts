"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  acquireQuickReviewDraftWriter,
  type QuickReviewActivityCommand,
  type QuickReviewDraftWriterLease,
} from "@/lib/client/quick-review-activity";
import {
  bindQuickReviewDraftToSchedule,
  compareAndSwapQuickReviewDraft,
  createQuickReviewDraft,
  createQuickReviewDraftIfAbsent,
  readQuickReviewDraft,
  removeQuickReviewDraftCas,
  resumeQuickReviewDraft,
  subscribeQuickReviewDraft,
  suspendQuickReviewDraft,
  upgradeQuickReviewDraftStorage,
  type QuickReviewDraft,
} from "@/lib/client/quick-review-draft";
import {
  parseInitialNow,
  type ConflictBody,
  type DraftAccess,
} from "@/components/quick-review-client-support";
import type { ReviewScheduleDto } from "@/lib/contracts";

type DraftCommandResult = { draftRevision: number | null };
type DraftCommandHandler = (
  action: QuickReviewActivityCommand,
) => DraftCommandResult | null | Promise<DraftCommandResult | null>;

export function useQuickReviewDraftRuntime(input: {
  userId: string;
  schedule: ReviewScheduleDto;
  targetCanPass: boolean;
  targetSubjectId: string | null;
  returnTo: string;
  initialNow: string;
  startActivity: (scheduleId: string, draftId: string, subjectId: string) => Promise<boolean>;
  finishActivity: (scheduleId: string, draftId: string) => Promise<boolean>;
  registerDraftHandler: (scheduleId: string, draftId: string, handler: DraftCommandHandler) => () => void;
}) {
  const {
    finishActivity,
    initialNow,
    registerDraftHandler,
    returnTo,
    schedule,
    startActivity,
    targetCanPass,
    targetSubjectId,
    userId,
  } = input;
  const router = useRouter();
  const [draft, setDraft] = useState<QuickReviewDraft | null>(null);
  const draftRef = useRef<QuickReviewDraft | null>(null);
  const writerRef = useRef<QuickReviewDraftWriterLease | null>(null);
  const accessRef = useRef<DraftAccess>("loading");
  const [access, setAccess] = useState<DraftAccess>("loading");
  const [remoteDraft, setRemoteDraft] = useState<QuickReviewDraft | null>(null);
  const [now, setNow] = useState(() => parseInitialNow(initialNow));
  const [error, setError] = useState<ConflictBody | null>(null);

  const publishDraft = useCallback((next: QuickReviewDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const publishAccess = useCallback((next: DraftAccess) => {
    accessRef.current = next;
    setAccess(next);
  }, []);

  const markStale = useCallback((latest: QuickReviewDraft | null) => {
    const writer = writerRef.current;
    writerRef.current = null;
    writer?.release();
    setRemoteDraft(latest);
    publishAccess("stale");
    setError({ error: "另一标签页已更新这份草稿。本页输入已冻结，请刷新并人工核对，系统不会自动覆盖。" });
  }, [publishAccess]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const writer = await acquireQuickReviewDraftWriter({
          userId,
          scheduleId: schedule.id,
        });
        if (cancelled) {
          writer?.release();
          return;
        }
        if (!writer) {
          publishDraft(readQuickReviewDraft(userId, schedule));
          publishAccess("remote-readonly");
          setError({ error: "这份快速复习草稿正由另一个标签页编辑。本页只读，不会改写它。" });
          return;
        }
        writerRef.current = writer;
        publishAccess("writable");

        let current = readQuickReviewDraft(userId, schedule);
        if (current?.draftRevision === 0) {
          const upgraded = upgradeQuickReviewDraftStorage(current);
          if (!upgraded.ok) {
            markStale(upgraded.latest);
            return;
          }
          current = upgraded.draft;
        }
        if (current?.baseRevision === null) {
          const bound = bindQuickReviewDraftToSchedule(current, schedule);
          if (!bound.ok) {
            markStale(bound.latest);
            return;
          }
          current = bound.draft;
        }

        const canStart = targetCanPass && schedule.status !== "PAUSED";
        let created = false;
        if (!current && canStart) {
          const result = createQuickReviewDraftIfAbsent(createQuickReviewDraft(userId, schedule));
          current = result.draft;
          created = result.created;
        }
        publishDraft(current);
        if (!current || !canStart) return;

        if (!current.suspended) {
          const recovered = await startActivity(schedule.id, current.draftId, targetSubjectId ?? "");
          if (cancelled) return;
          if (!recovered) {
            writer.release();
            if (writerRef.current === writer) writerRef.current = null;
            publishAccess("remote-readonly");
            setError({ error: "无法证明这项运行中草稿的活动所有权。本页已转为只读。" });
          }
          return;
        }

        if (created) {
          const started = await startActivity(schedule.id, current.draftId, targetSubjectId ?? "");
          if (cancelled) {
            if (started) void finishActivity(schedule.id, current.draftId);
            return;
          }
          if (!started) {
            setError({ error: "存在普通专注、另一项快速复习，或浏览器不支持安全互斥。本项草稿保持挂起。" });
            return;
          }
          const resumed = compareAndSwapQuickReviewDraft(current, resumeQuickReviewDraft(current));
          if (!resumed.ok) {
            void finishActivity(schedule.id, current.draftId);
            markStale(resumed.latest);
            return;
          }
          publishDraft(resumed.draft);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      const writer = writerRef.current;
      writerRef.current = null;
      writer?.release();
    };
  }, [
    finishActivity,
    markStale,
    publishAccess,
    publishDraft,
    schedule,
    startActivity,
    targetCanPass,
    targetSubjectId,
    userId,
  ]);

  useEffect(() => subscribeQuickReviewDraft(
    userId,
    schedule.id,
    (nextDraft) => {
      if (accessRef.current === "writable") {
        const current = draftRef.current;
        if (!current || !nextDraft || current.draftId !== nextDraft.draftId || current.draftRevision !== nextDraft.draftRevision) {
          markStale(nextDraft);
        }
        return;
      }
      if (accessRef.current === "remote-readonly") publishDraft(nextDraft);
      else setRemoteDraft(nextDraft);
    },
  ), [markStale, publishDraft, schedule.id, userId]);

  useEffect(() => {
    const registeredDraftId = draft?.draftId;
    if (access !== "writable" || !registeredDraftId) return;
    return registerDraftHandler(schedule.id, registeredDraftId, async (action) => {
      const current = draftRef.current;
      if (!writerRef.current || accessRef.current !== "writable" || !current || current.draftId !== registeredDraftId) {
        return null;
      }
      if (action === "discard") {
        const removed = removeQuickReviewDraftCas(current);
        if (!removed.ok) {
          markStale(removed.latest);
          return null;
        }
        publishDraft(null);
        window.setTimeout(() => router.replace(returnTo), 0);
        return { draftRevision: null };
      }
      const suspended = compareAndSwapQuickReviewDraft(current, suspendQuickReviewDraft(current));
      if (!suspended.ok) {
        markStale(suspended.latest);
        return null;
      }
      publishDraft(suspended.draft);
      return { draftRevision: suspended.draft.draftRevision };
    });
  }, [access, draft?.draftId, markStale, publishDraft, registerDraftHandler, returnTo, router, schedule.id]);

  const getCurrentDraft = useCallback(() => draftRef.current, []);
  const hasWriter = useCallback(() => writerRef.current !== null, []);

  return {
    access,
    draft,
    error,
    getCurrentDraft,
    hasWriter,
    markStale,
    now,
    publishDraft,
    remoteDraft,
    setError,
    setNow,
  };
}

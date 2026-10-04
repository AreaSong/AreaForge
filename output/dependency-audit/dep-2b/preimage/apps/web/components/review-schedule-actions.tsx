"use client";

import { pauseReviewSchedule, resumeReviewSchedule } from "@/lib/api/review-schedule";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { shanghaiDateInputToIso } from "@/lib/formatters";
import { classifyApiFailure } from "@/lib/client/api-errors";
import { mutationFeedback } from "@/lib/client/mutation-feedback";

export function ReviewScheduleActions(props: { id: string; status: "ACTIVE" | "PAUSED"; revision: number; returnTo: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeDate, setResumeDate] = useState("");
  const actionRef = useRef<HTMLButtonElement>(null);

  async function submit() {
    if (props.status === "PAUSED" && !resumeDate) {
      setError("请选择恢复后的首次复习日期。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = props.status === "ACTIVE"
        ? await pauseReviewSchedule(props.id, { expectedRevision: props.revision, reason: "用户主动暂停" })
        : await resumeReviewSchedule(props.id, {
            expectedRevision: props.revision,
            dueDate: shanghaiDateInputToIso(resumeDate),
          });
      if (classifyApiFailure(response).kind === "unauthorized") return redirectToLoginWithCurrentLocation();
      if (response.status === 404) {
        router.replace(props.returnTo);
        return;
      }
      if (!response.ok) {
        setError(mutationFeedback(response, "排期状态更新失败，当前状态没有改变；请显式重试。").message);
        return;
      }
      router.refresh();
      window.requestAnimationFrame(() => actionRef.current?.focus());
    } catch {
      setError("网络不可用，排期状态没有改变；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div role="group" aria-label="排期操作" aria-busy={pending} className="space-y-2">
      {props.status === "PAUSED" ? (
        <Field label="恢复后的首次复习日期" htmlFor="review-schedule-resume-date">
          <Input
            id="review-schedule-resume-date"
            type="date"
            required
            value={resumeDate}
            onChange={(event) => setResumeDate(event.target.value)}
            className="mt-1 block bg-[#151a20] px-2"
          />
        </Field>
      ) : null}
      <Button
        ref={actionRef}
        type="button"
        variant="secondary"
        loading={pending}
        loadingLabel="处理中..."
        disabled={pending || (props.status === "PAUSED" && !resumeDate)}
        onClick={() => void submit()}
        className="h-10 text-zinc-200"
      >
        {props.status === "ACTIVE" ? "暂停排期" : "恢复排期"}
      </Button>
      <p className="sr-only" aria-live="polite">{pending ? (props.status === "ACTIVE" ? "正在暂停排期" : "正在恢复排期") : ""}</p>
      {error ? <Alert tone="danger" className="mt-2">{error}</Alert> : null}
    </div>
  );
}

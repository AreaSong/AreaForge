"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { WorkbenchState } from "@/components/workbench-state";
import { getWorkbenchFallback } from "@/lib/navigation/workbench-context";

export default function ProtectedAppError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const fallback = getWorkbenchFallback(pathname);

  useEffect(() => {
    document.title = "工作台出错 | AreaForge";
  }, []);

  return (
    <WorkbenchState
      icon={<AlertTriangle className="h-5 w-5 text-rose-200" aria-hidden="true" />}
      eyebrow="当前操作未完成"
      title="这个工作台暂时无法继续"
      description="刚才的页面读取没有成功。先重试当前工作台；如果仍然失败，可以返回所属工作台继续处理其他行动。"
      detail={props.error.digest ? <>参考编号：<span className="font-mono">{props.error.digest}</span></> : undefined}
      actions={(
        <>
          <Button type="button" variant="primary" size="lg" onClick={props.reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />重试
          </Button>
          <ButtonLink href={fallback.href} variant="secondary" size="lg">{fallback.label}</ButtonLink>
        </>
      )}
      role="alert"
    />
  );
}

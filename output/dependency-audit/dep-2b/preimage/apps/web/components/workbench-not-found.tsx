"use client";

import { SearchX } from "lucide-react";
import { useEffect } from "react";
import { WorkbenchState } from "@/components/workbench-state";
import { ButtonLink } from "@/components/ui/button";

export function WorkbenchNotFound(props: {
  title: string;
  description: string;
  href: string;
  linkLabel: string;
}) {
  useEffect(() => {
    document.title = `${props.title} | AreaForge`;
  }, [props.title]);

  return (
    <WorkbenchState
      icon={<SearchX className="h-5 w-5 text-amber-200" aria-hidden="true" />}
      eyebrow="内容不可用"
      title={props.title}
      description={props.description}
      actions={<ButtonLink href={props.href} variant="primary">{props.linkLabel}</ButtonLink>}
      role="alert"
    />
  );
}

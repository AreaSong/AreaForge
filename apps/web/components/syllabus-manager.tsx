"use client";

import { useSyllabusManagerController } from "@/components/syllabus-manager-controller";
import type { SyllabusManagerProps } from "@/components/syllabus-manager-types";
import { SyllabusManagerView } from "@/components/syllabus-manager-view";

export function SyllabusManager(props: SyllabusManagerProps) {
  const controller = useSyllabusManagerController(props);
  return <SyllabusManagerView controller={controller} />;
}

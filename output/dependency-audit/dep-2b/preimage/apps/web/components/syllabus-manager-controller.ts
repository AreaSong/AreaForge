"use client";

import { useSyllabusCommandRuntime } from "@/components/syllabus-manager-command-runtime";
import { useSyllabusCreateController } from "@/components/syllabus-manager-create-controller";
import { useSyllabusNodeController } from "@/components/syllabus-manager-node-controller";
import type { SyllabusManagerProps } from "@/components/syllabus-manager-types";
import { useSyllabusWorkbenchController } from "@/components/syllabus-manager-workbench-controller";

export function useSyllabusManagerController(props: SyllabusManagerProps) {
  const runtime = useSyllabusCommandRuntime();
  const workbench = useSyllabusWorkbenchController(props);
  const create = useSyllabusCreateController({
    workbench,
    runtime,
    initialCreate: Boolean(props.initialCreate),
  });
  const nodes = useSyllabusNodeController({ workbench, runtime });

  return {
    runtime,
    workbench,
    create,
    nodes,
  };
}

export type SyllabusManagerController = ReturnType<typeof useSyllabusManagerController>;

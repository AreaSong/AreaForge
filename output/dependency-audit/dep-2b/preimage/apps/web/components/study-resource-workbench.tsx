"use client";

import { useRestoreListReturn } from "@/components/list-return-context";
import { StudyResourceWorkbenchView } from "@/components/study-resource-workbench-view";
import { useLinkResourceCreate } from "@/components/use-link-resource-create";
import {
  useStudyResourceDraft,
  useStudyResourceDraftPersistence,
} from "@/components/use-study-resource-draft";
import { useStudyResourceListController } from "@/components/use-study-resource-list-controller";
import { useStudyResourceUploadWorkflow } from "@/components/use-study-resource-upload-workflow";
import type { StudyResourceDto, StudyResourceEditorOptionsDto } from "@/lib/contracts";

export interface StudyResourceWorkbenchProps {
  userId: string;
  resources: StudyResourceDto[];
  archivedResources: StudyResourceDto[];
  options: StudyResourceEditorOptionsDto;
  initialSubjectId?: string;
  initialCreate?: boolean;
  initialQuery?: string;
}

export function StudyResourceWorkbench(props: StudyResourceWorkbenchProps) {
  useRestoreListReturn();
  const draft = useStudyResourceDraft({
    userId: props.userId,
    options: props.options,
    initialCreate: props.initialCreate,
    initialSubjectId: props.initialSubjectId,
  });
  const upload = useStudyResourceUploadWorkflow({ userId: props.userId, draft });
  useStudyResourceDraftPersistence(draft, upload.hasDuplicateUpload);
  const link = useLinkResourceCreate({
    draft,
    initialQuery: props.initialQuery,
    initialSubjectId: props.initialSubjectId,
  });
  const list = useStudyResourceListController({ initialQuery: props.initialQuery });

  return (
    <StudyResourceWorkbenchView
      resources={props.resources}
      archivedResources={props.archivedResources}
      options={props.options}
      initialSubjectId={props.initialSubjectId}
      initialQuery={props.initialQuery}
      draft={draft}
      upload={upload}
      link={link}
      list={list}
    />
  );
}

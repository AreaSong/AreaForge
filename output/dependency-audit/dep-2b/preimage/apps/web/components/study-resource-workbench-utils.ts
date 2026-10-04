import { splitTags, type UploadItem, type UploadResolutionRequest } from "@/components/study-resource-workbench-support";

export function buildUploadResolutionRequest(
  item: UploadItem,
  metadata: { subjectId: string; category: string; tags: string },
): UploadResolutionRequest {
  if (!item.staging || !item.decision) throw new Error("Upload decision is incomplete");
  return {
    attachmentId: item.staging.attachment.id,
    decision: item.decision,
    reuseResourceId: item.decision === "reuse" ? item.reuseResourceId : undefined,
    title: item.originalName,
    subjectId: metadata.subjectId || null,
    category: metadata.category,
    tags: splitTags(metadata.tags),
  };
}

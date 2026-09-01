import type { SafeMarkdownNode } from "@areaforge/core";

export interface ReviewTargetDto {
  id: string;
  subjectId: string | null;
  type: "NOTE" | "MISTAKE" | "STUDY_RESOURCE" | "SYLLABUS_NODE";
  title: string;
  subtitle: string;
  canonicalHref: string;
  body: SafeMarkdownNode[];
  revealTitle: string | null;
  revealBody: SafeMarkdownNode[];
  canPass: boolean;
}

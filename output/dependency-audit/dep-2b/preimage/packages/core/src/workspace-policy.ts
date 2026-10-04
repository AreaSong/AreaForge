/** 工作区创建与首次设置共享的产品边界，避免页面和 API 各自维护上限。 */
export const EXAM_WORKSPACE_LIMITS = {
  nameMaxLength: 120,
  stableKeyMaxLength: 80,
  subjectNameMaxLength: 120,
  subjectStableKeyMaxLength: 80,
  groupNameMaxLength: 120,
  groupStableKeyMaxLength: 80,
  maxInitialSubjects: 12,
  maxInitialGroups: 20,
} as const;

export const EXAM_WORKSPACE_DEFAULTS = {
  name: "我的学习工作区",
  stableKeyPrefix: "workspace",
} as const;

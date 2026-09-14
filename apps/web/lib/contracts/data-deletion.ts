export type DeletionScope = "ACCOUNT" | "WORKSPACE" | "RESOURCE";
export type TrashResourceType = "Note" | "Mistake" | "StudyTask" | "StudyResource" | "KnowledgePoint";
export interface DeletionTargetInput { scope: DeletionScope; workspaceId?: string; resourceType?: TrashResourceType; resourceId?: string }
export interface DeletionPreviewView { protocol: string; scope: DeletionScope; fingerprint: string; targetLabel: string; counts: Record<string, number>;
  totalObjects: number; blockers: string[]; canConfirm: boolean; retentionHours: number; securityCleanup: string[] }
export interface DeletionIntentView { id: string; scope: DeletionScope; resourceType: TrashResourceType | null; workspaceId: string | null;
  state: string; revision: number; availableAt: string; createdAt: string; completedAt: string | null; irreversible: boolean;
  errorCode: string | null; counts: Record<string, number>; attempt: number; canCancel: boolean; canRestore: boolean; canRetry: boolean }
export interface DeletionCandidate { id: string; title: string }
export interface DeletionResponse { error?: string; preview?: DeletionPreviewView; intent?: DeletionIntentView; intents?: DeletionIntentView[]; candidates?: DeletionCandidate[] }

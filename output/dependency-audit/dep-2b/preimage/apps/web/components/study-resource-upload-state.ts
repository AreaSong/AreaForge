import {
  mergePendingUploads,
  mergeUploadItemUpdates,
  type UploadItem,
} from "@/components/study-resource-workbench-support";

export type UploadItemsAction =
  | { type: "replace"; items: UploadItem[] }
  | { type: "merge-pending"; items: UploadItem[] }
  | { type: "merge-updates"; items: UploadItem[] }
  | { type: "mark-staging"; keys: ReadonlySet<string> }
  | { type: "mark-failed"; keys: ReadonlySet<string>; message: string }
  | { type: "update-decision"; itemKey: string; decision: UploadItem["decision"] }
  | { type: "update-reuse-resource"; itemKey: string; reuseResourceId: string }
  | { type: "adopt-resolved"; itemKey: string; resultTitle: string }
  | {
    type: "align-resolved-baseline";
    itemKey: string;
    decision: UploadItem["decision"];
    reuseResourceId?: string;
  };

export function reduceUploadItems(
  state: UploadItem[],
  action: UploadItemsAction,
): UploadItem[] {
  if (action.type === "replace") return action.items;
  if (action.type === "merge-pending") return mergePendingUploads(state, action.items);
  if (action.type === "merge-updates") return mergeUploadItemUpdates(state, action.items);
  if (action.type === "mark-staging") {
    return state.map((item) => action.keys.has(item.key)
      ? { ...item, status: "staging" }
      : item);
  }
  if (action.type === "mark-failed") {
    return state.map((item) => action.keys.has(item.key)
      ? { ...item, status: "failed", error: action.message }
      : item);
  }
  if (action.type === "update-decision") {
    return state.map((item) => item.key === action.itemKey
      ? { ...item, decision: action.decision, submittedSnapshot: undefined }
      : item);
  }
  if (action.type === "update-reuse-resource") {
    return state.map((item) => item.key === action.itemKey
      ? { ...item, reuseResourceId: action.reuseResourceId, submittedSnapshot: undefined }
      : item);
  }
  if (action.type === "adopt-resolved") {
    return state.map((item) => item.key === action.itemKey
      ? {
        ...item,
        status: "done",
        submittedSnapshot: undefined,
        error: undefined,
        resultTitle: action.resultTitle,
      }
      : item);
  }
  return state.map((item) => item.key === action.itemKey
    ? {
      ...item,
      decision: action.decision,
      reuseResourceId: action.reuseResourceId,
      submittedSnapshot: undefined,
      error: "已对齐服务端终态基线；请检查后再次点击应用全部决策。",
    }
    : item);
}

export function createSelectedUploadItems(
  files: FileList | File[],
  randomId: () => string = () => crypto.randomUUID(),
): UploadItem[] {
  return Array.from(files).map((file) => ({
    key: randomId(),
    file,
    originalName: file.name,
    status: "ready",
  }));
}

import { DataDeleteError } from "@areaforge/core";
import { deleteModel, deletePrimaryKey } from "./data-delete-models";
type Args = Record<string, unknown>;
type Keys = Map<string, Record<string, string>[]>;
const identityModels = new Set(["User", "AuthSession", "AuthActionToken"]);

/** 必选 to-one 不支持 where；内部补主键只用于响应交付前重验，不进入 DTO。 */
export function deletionIdentitySelection(model: string, args: Args): Args {
  const result = { ...args }; const keys = deletePrimaryKey(model);
  if (args.select) result.select = { ...(args.select as Args), ...Object.fromEntries(keys.map(key => [key, true])) };
  if (args.omit) result.omit = { ...(args.omit as Args), ...Object.fromEntries(keys.map(key => [key, false])) };
  for (const mode of ["select", "include"]) {
    if (!result[mode]) continue;
    const selection = { ...(result[mode] as Args) };
    for (const field of deleteModel(model).fields.filter(field => field.kind === "object")) {
      const value = selection[field.name];
      if (value) selection[field.name] = deletionIdentitySelection(field.type, value === true ? {} : value as Args);
    }
    result[mode] = selection;
  }
  return result;
}

/** 不重放 mutation；冻结对象即使出现在必选关联中也拒绝整个响应。 */
export function checkedDeletionResult(model: string, value: unknown, original: Args, fences: Keys): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(row => checkedDeletionResult(model, row, original, fences));
  if (typeof value !== "object") throw new DataDeleteError("DATA_DELETE_READ_BUSY", true);
  const row = value as Args; const keys = deletePrimaryKey(model);
  if (keys.some(key => typeof row[key] !== "string" && typeof row[key] !== "number")) throw new DataDeleteError("DATA_DELETE_READ_BUSY", true);
  if (!identityModels.has(model) && fences.get(model)?.some(key => keys.every(name => row[name] === key[name]))) {
    throw new DataDeleteError("DATA_DELETE_READ_BUSY", true);
  }
  const result = { ...row };
  for (const field of deleteModel(model).fields.filter(field => field.kind === "object")) {
    const selection = (original.select as Args | undefined)?.[field.name] ?? (original.include as Args | undefined)?.[field.name];
    if (selection && field.name in row) result[field.name] = checkedDeletionResult(field.type, row[field.name], selection === true ? {} : selection as Args, fences);
  }
  for (const key of keys) {
    if ((original.select && !(original.select as Args)[key]) || (original.omit as Args | undefined)?.[key]) delete result[key];
  }
  return result;
}

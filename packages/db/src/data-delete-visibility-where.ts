import { DataDeleteError } from "@areaforge/core";
import { deleteModel } from "./data-delete-models";
type Where = Record<string, unknown>;
type Visibility = (model: string) => Where | null;

/** some/none/every 和 nullable to-one 都以可见子集解释，不能靠隐藏正文做存在性查询。 */
export function deletionRelationWhere(model: string, input: Where, visible: Visibility, depth = 0): Where {
  if (depth > 25) throw new DataDeleteError("DATA_DELETE_READ_FILTER_LIMIT");
  const result: Where = {}; const extra: Where[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) { result[key] = value; continue; }
    if (["AND", "OR", "NOT"].includes(key)) {
      result[key] = Array.isArray(value) ? value.map(item => deletionRelationWhere(model, item as Where, visible, depth + 1))
        : deletionRelationWhere(model, value as Where, visible, depth + 1);
      continue;
    }
    const field = deleteModel(model).fields.find(candidate => candidate.name === key && candidate.kind === "object");
    if (!field) { result[key] = value; continue; }
    const condition = value as Where | null; const predicate = visible(field.type);
    const child = (where: Where) => deletionRelationWhere(field.type, where, visible, depth + 1);
    if (field.isList) {
      const rewritten: Where = {};
      for (const [quantifier, where] of Object.entries(condition ?? {})) {
        if (where === undefined) { rewritten[quantifier] = where; continue; }
        const nested = child(where as Where);
        rewritten[quantifier] = quantifier === "every" && predicate ? { OR: [{ NOT: predicate }, nested] } : addVisible(nested, predicate);
      }
      result[key] = rewritten; continue;
    }
    if (condition === null || condition?.is === null) {
      if (predicate) extra.push({ OR: [{ [key]: { is: null } }, { [key]: { is: { NOT: predicate } } }] });
      else result[key] = value;
      if (!condition || Object.keys(condition).length === 1) continue;
    }
    if (condition?.isNot === null && predicate) {
      extra.push({ [key]: { is: predicate } });
      if (Object.keys(condition).length === 1) continue;
    }
    if (condition && ("is" in condition || "isNot" in condition)) {
      const rewritten: Where = {};
      for (const [quantifier, where] of Object.entries(condition)) {
        if (where === undefined) rewritten[quantifier] = where;
        else if (where === null && !predicate) rewritten[quantifier] = null;
        else if (where !== null) rewritten[quantifier] = addVisible(child(where as Where), predicate);
      }
      if (Object.keys(rewritten).length) extra.push({ [key]: rewritten });
    } else if (condition) result[key] = { is: addVisible(child(condition), predicate) };
  }
  if (extra.length) result.AND = [...(result.AND === undefined ? [] : Array.isArray(result.AND) ? result.AND : [result.AND]), ...extra];
  return result;
}

function addVisible(where: Where, predicate: Where | null): Where {
  if (!predicate) return where;
  return { ...where, AND: [...(where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND]), predicate] };
}

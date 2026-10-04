import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertUiPrimitiveBoundary,
  collectUiPrimitiveBoundaryReport,
  type PublicUiCloneCounts,
} from "./web-ui-primitives-boundary";

const workspace = mkdtempSync(path.join(tmpdir(), "areaforge-web-ui-primitives-"));
try {
  mkdirSync(path.join(workspace, "apps/web/app"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/components/ui"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/components/generated"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/components/__tests__"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/routes"), { recursive: true });

  write("apps/web/components/ui/raw.tsx", "export const Primitive = () => <button />;\n");
  write("apps/web/components/generated/raw.tsx", "export const Generated = () => <input />;\n");
  write("apps/web/components/__tests__/raw.tsx", "export const Test = () => <textarea />;\n");
  write("apps/web/components/exempt.tsx", `export const Exempt = () => <>\n  <input type=\"checkbox\" />\n  <input type=\"radio\" />\n  <input type=\"file\" hidden />\n  <input type=\"hidden\" value=\"semantic\" />\n</>;\n`);
  write("apps/web/components/multiline.tsx", "export const Multiline = () => (\n  <button\n    type=\"button\"\n  >Save</button>\n);\n");
  write("apps/web/lib/routes/route-view.tsx", "export const RouteView = () => <button type=\"button\">Open</button>;\n");
  write("apps/web/components/icon-text.tsx", 'export const IconText = () => <Button aria-label="新增" className="size-9"><Plus aria-hidden />新增</Button>;\n');
  write("apps/web/app/login/components/journey-timeline.tsx", '<ol role="tablist"><Button role="tab" aria-selected={true}>步骤</Button></ol>;\n');
  write("apps/web/components/simulation-detail-workspace.tsx", '<div role="tablist"><Button role="tab" aria-selected={true}>科目</Button></div>;\n');

  const budget = {
    "apps/web/components/exempt.tsx": { input: 2 },
    "apps/web/components/multiline.tsx": { button: 1 },
    "apps/web/lib/routes/route-view.tsx": { button: 1 },
  };
  const initial = collectUiPrimitiveBoundaryReport(workspace, budget);
  assert.deepEqual(initial.issues, []);
  assert.equal(initial.debt[0]?.line, 2);
  assert(initial.debt.some((item) => item.file.endsWith("lib/routes/route-view.tsx")), "route compositions must be scanned");
  assert.equal(
    initial.debt.filter((item) => item.file.endsWith("components/exempt.tsx")).length,
    2,
    "checkbox and radio must use shared primitives while file and hidden inputs stay exempt",
  );
  assert.doesNotThrow(() => assertUiPrimitiveBoundary(workspace, budget));

  write("apps/web/components/unknown.tsx", "export const Unknown = () => <input />;\n");
  const unknown = collectUiPrimitiveBoundaryReport(workspace, budget);
  assert(unknown.issues.some((issue) => issue.includes("unknown.tsx introduces unbudgeted")));

  write("apps/web/components/multiline.tsx", "export const Multiline = () => <>\n  <button type=\"button\">Save</button>\n  <button type=\"button\">Again</button>\n</>;\n");
  const increased = collectUiPrimitiveBoundaryReport(workspace, budget);
  assert(increased.issues.some((issue) => issue.includes("multiline.tsx button debt is 2, but the exact legacy budget is 1")));

  write("apps/web/components/multiline.tsx", "export const Multiline = () => <div />;\n");
  const reducedWithoutRatchet = collectUiPrimitiveBoundaryReport(workspace, budget);
  assert(reducedWithoutRatchet.issues.some((issue) => issue.includes("stale legacy budget")));

  write("apps/web/app/malformed.tsx", "export const Broken = () => <button>broken;\n");
  const malformed = collectUiPrimitiveBoundaryReport(workspace, budget);
  assert(malformed.issues.some((issue) => issue.includes("malformed.tsx") && issue.includes("cannot parse TSX")));

  write("apps/web/components/unknown.tsx", "export const Unknown = () => <div />;\n");
  write("apps/web/components/multiline.tsx", "export const Multiline = () => (\n  <button type=\"button\">Save</button>\n);\n");
  write("apps/web/app/malformed.tsx", "export const Broken = () => <div />;\n");
  write("apps/web/components/icon-clone.tsx", 'export const IconClone = () => <Button aria-label="新增" title="新增" className="size-9 p-0"><Plus aria-hidden /></Button>;\n');
  write("apps/web/components/tab-clone.tsx", '<div role="tablist" aria-label="模式"><Button role="tab" aria-selected={true}>一个</Button><Button role="tab" aria-selected={false}>两个</Button></div>;\n');
  write("apps/web/components/segmented-clone.tsx", '<div role="group" aria-label="模式"><ModeButton active={true}>一个</ModeButton><ModeButton active={false}>两个</ModeButton></div>;\n');
  write("apps/web/components/group-pressed-clone.tsx", '<div role="group" aria-label="模式"><Button aria-pressed={true}>一个</Button><Button aria-pressed={false}>两个</Button></div>;\n');
  write("apps/web/components/nav-segmented-clone.tsx", '<nav aria-label="视图"><Button aria-pressed={true}>当前</Button><Button aria-pressed={false}>历史</Button></nav>;\n');
  write("apps/web/components/color-clone.tsx", 'const colors = ["#fff", "#000", "#fff"]; export const Colors = () => <div>{colors.map((color) => <Button key={color} aria-label={color} className="size-7 p-0" style={{ backgroundColor: color }} onClick={() => undefined} />)}</div>;\n');
  write("apps/web/components/valid-color-group.tsx", 'const color = "#fff"; export const Colors = () => <div role="group" aria-label="颜色"><Button aria-pressed={true} className="size-7 p-0" style={{ backgroundColor: color }} onClick={() => undefined} /></div>;\n');
  write("apps/web/components/subject-choice-group.tsx", '<div role="group" aria-label="科目"><label><Checkbox checked={true} onChange={() => undefined} />科目</label><label><Checkbox checked={false} onChange={() => undefined} />另一科目</label></div>;\n');
  const clones = collectUiPrimitiveBoundaryReport(workspace, budget);
  assert(clones.issues.some((issue) => issue.includes("icon-clone.tsx") && issue.includes("local-icon-button")));
  assert(clones.issues.some((issue) => issue.includes("tab-clone.tsx") && issue.includes("tablist-clone")));
  assert(clones.issues.some((issue) => issue.includes("segmented-clone.tsx") && issue.includes("segmented-control-clone")));
  assert(clones.issues.some((issue) => issue.includes("group-pressed-clone.tsx") && issue.includes("segmented-control-clone")));
  assert(clones.issues.some((issue) => issue.includes("nav-segmented-clone.tsx") && issue.includes("segmented-control-clone")));
  assert(clones.issues.some((issue) => issue.includes("color-clone.tsx") && issue.includes("color-swatch-clone")));
  assert.equal(clones.publicUiSummary["apps/web/components/valid-color-group.tsx"]?.["segmented-control-clone"], undefined, "color swatch groups are not segmented controls");
  assert.equal(clones.publicUiSummary["apps/web/components/subject-choice-group.tsx"], undefined, "checkbox groups are not segmented controls");
  assert.equal(clones.publicUiSummary["apps/web/components/icon-text.tsx"], undefined, "icon + visible text is not an IconButton clone");
  assert.equal(clones.publicUiSummary["apps/web/app/login/components/journey-timeline.tsx"], undefined, "allowlisted complex tabs stay explicit exceptions");
  assert.equal(clones.publicUiSummary["apps/web/components/simulation-detail-workspace.tsx"], undefined, "allowlisted subject tabs stay explicit exceptions");

  const publicBudget: Record<string, PublicUiCloneCounts> = {
    "apps/web/components/icon-clone.tsx": { "local-icon-button": 1 },
    "apps/web/components/tab-clone.tsx": { "tablist-clone": 1 },
    "apps/web/components/segmented-clone.tsx": { "segmented-control-clone": 1 },
    "apps/web/components/group-pressed-clone.tsx": { "segmented-control-clone": 1 },
    "apps/web/components/nav-segmented-clone.tsx": { "segmented-control-clone": 1 },
    "apps/web/components/color-clone.tsx": { "color-swatch-clone": 2 },
    "apps/web/components/valid-color-group.tsx": { "color-swatch-clone": 1 },
  };
  const cleanBudget = { ...budget, "apps/web/components/multiline.tsx": { button: 1 } };
  const budgetedClones = collectUiPrimitiveBoundaryReport(workspace, cleanBudget, publicBudget);
  assert.equal(budgetedClones.issues.length, 0, "exact public UI clone budgets should permit only known debt");
  assert.doesNotThrow(() => assertUiPrimitiveBoundary(workspace, cleanBudget, publicBudget));
  const underBudget = collectUiPrimitiveBoundaryReport(workspace, cleanBudget, {
    ...publicBudget,
    "apps/web/components/color-clone.tsx": { "color-swatch-clone": 1 },
  });
  assert(underBudget.issues.some((issue) => issue.includes("color-clone.tsx color-swatch-clone debt is 2")));
  const stalePublicBudget = collectUiPrimitiveBoundaryReport(workspace, cleanBudget, {
    ...publicBudget,
    "apps/web/components/cleared.tsx": { "local-icon-button": 1 },
  });
  assert(stalePublicBudget.issues.some((issue) => issue.includes("stale public UI budget")));

  console.log("web UI primitive boundary selftest passed.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

function write(relative: string, contents: string): void {
  const absolute = path.join(workspace, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { evaluateResidualCoverage } from "./enterprise-operability-residual-coverage";
import { readResidualLedgerV2, type ResidualItemV2 } from "./residual-ledger-common";

const root = process.cwd();
const controlPlane = readFileSync(
  path.join(root, "docs/development/long-term-operability-control-plane.md"),
  "utf8",
);
const ledger = readResidualLedgerV2({ root });

assertValid(controlPlane, ledger.items);

const futureItem: ResidualItemV2 = {
  ...structuredClone(ledger.items[0]),
  id: "AF-RISK-OPS-999",
};
assertInvalid(controlPlane, [...ledger.items, futureItem], "AF-RISK-OPS-999");
assertInvalid(
  `${controlPlane}\n- \`AF-RISK-OPS-999\`：清单外文本不能满足指定章节覆盖。\n`,
  [...ledger.items, futureItem],
  "AF-RISK-OPS-999",
);
assertInvalid(
  insertBeforeNextHeading(controlPlane, "- `AF-RISK-OPS-001`：重复条目。"),
  ledger.items,
  "AF-RISK-OPS-001",
);
assertInvalid(
  insertBeforeNextHeading(controlPlane, "- `AF-RISK-OPS-999`：未知条目。"),
  ledger.items,
  "AF-RISK-OPS-999",
);
assertInvalid(
  controlPlane,
  ledger.items.map((item, index) => index === 0 ? { ...item, reviewAt: "" } : item),
  ledger.items[0]?.id ?? "incomplete item",
);
assertInvalid(
  `${controlPlane}\n## 当前必须持续复核的证据\n\n## 重复章节结束\n`,
  ledger.items,
  "expected exactly one",
);
assertInvalid(
  controlPlane.slice(0, controlPlane.indexOf("\n## 本地预检")),
  ledger.items,
  "must be followed",
);

console.log("enterprise operability preflight selftest passed.");

function insertBeforeNextHeading(doc: string, line: string): string {
  const marker = "\n## 本地预检";
  if (!doc.includes(marker)) throw new Error(`missing marker ${marker}`);
  return doc.replace(marker, `\n${line}\n${marker}`);
}

function assertValid(doc: string, items: ResidualItemV2[]): void {
  const result = evaluateResidualCoverage(doc, items);
  if (!result.ok) throw new Error(`expected valid residual coverage: ${JSON.stringify(result)}`);
}

function assertInvalid(doc: string, items: ResidualItemV2[], expected: string): void {
  const result = evaluateResidualCoverage(doc, items);
  if (result.ok || !JSON.stringify(result).includes(expected)) {
    throw new Error(`expected invalid residual coverage containing ${expected}: ${JSON.stringify(result)}`);
  }
}

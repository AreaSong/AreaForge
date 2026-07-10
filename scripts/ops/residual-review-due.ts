import { readFileSync } from "node:fs";
import path from "node:path";

type ResidualLedger = {
  items?: ResidualItem[];
};

type ResidualItem = {
  id: string;
  type: string;
  reviewAt: string;
  currentImpact: string;
  executableNow: boolean;
  closeCondition: string;
  requiredEvidence: string;
  ownerSkills: string[];
};

type ClassifiedResidual = ResidualItem & {
  daysUntilReview: number;
  reviewStatus: "overdue" | "due_today" | "due_soon" | "future";
};

type Options = {
  asOf: Date;
  warnDays: number;
  failOnOverdue: boolean;
  failOnDue: boolean;
  failOnDueSoon: boolean;
};

const root = process.cwd();
const ledgerPath = "docs/development/residual-risk-ledger.json";

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const ledger = JSON.parse(read(ledgerPath)) as ResidualLedger;
  const items = (ledger.items ?? []).map((item) => classifyResidual(item, options));
  const overdue = items.filter((item) => item.reviewStatus === "overdue");
  const dueToday = items.filter((item) => item.reviewStatus === "due_today");
  const dueSoon = items.filter((item) => item.reviewStatus === "due_soon");
  const shouldFail =
    (options.failOnOverdue && overdue.length > 0) ||
    (options.failOnDue && (overdue.length > 0 || dueToday.length > 0)) ||
    (options.failOnDueSoon && (overdue.length > 0 || dueToday.length > 0 || dueSoon.length > 0));

  for (const item of [...overdue, ...dueToday, ...dueSoon]) {
    console.log(`${label(item.reviewStatus)} ${item.id}: reviewAt=${item.reviewAt}; daysUntil=${item.daysUntilReview}; owner=${item.ownerSkills.join(", ")}`);
  }

  const output = {
    ok: !shouldFail,
    checkedAt: new Date().toISOString(),
    asOf: dateKey(options.asOf),
    warnDays: options.warnDays,
    source: ledgerPath,
    safetyFacts: {
      readOnly: true,
      productionWriteAttempted: false,
      serverCommandAttempted: false,
      networkRequested: false,
      secretValuePrinted: false,
    },
    counts: {
      total: items.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      dueSoon: dueSoon.length,
      future: items.filter((item) => item.reviewStatus === "future").length,
    },
    gate: {
      failOnOverdue: options.failOnOverdue,
      failOnDue: options.failOnDue,
      failOnDueSoon: options.failOnDueSoon,
      failed: shouldFail,
    },
    dueItems: [...overdue, ...dueToday, ...dueSoon].map((item) => ({
      id: item.id,
      type: item.type,
      reviewAt: item.reviewAt,
      reviewStatus: item.reviewStatus,
      daysUntilReview: item.daysUntilReview,
      executableNow: item.executableNow,
      ownerSkills: item.ownerSkills,
      closeCondition: item.closeCondition,
      requiredEvidence: item.requiredEvidence,
    })),
  };
  console.log(JSON.stringify(output, null, 2));

  if (shouldFail) {
    console.error(
      `residual review due failed: overdue=${overdue.length}; dueToday=${dueToday.length}; dueSoon=${dueSoon.length}.`,
    );
    process.exit(1);
  }
}

function classifyResidual(item: ResidualItem, options: Options): ClassifiedResidual {
  const reviewDate = parseDate(item.reviewAt);
  const daysUntilReview = Math.round((reviewDate.getTime() - options.asOf.getTime()) / 86_400_000);
  return {
    ...item,
    daysUntilReview,
    reviewStatus: reviewStatus(daysUntilReview, options.warnDays),
  };
}

function reviewStatus(daysUntilReview: number, warnDays: number): ClassifiedResidual["reviewStatus"] {
  if (daysUntilReview < 0) return "overdue";
  if (daysUntilReview === 0) return "due_today";
  if (daysUntilReview <= warnDays) return "due_soon";
  return "future";
}

function parseOptions(args: string[]): Options {
  let asOf = todayUtcDate();
  let warnDays = 14;
  let failOnOverdue = false;
  let failOnDue = false;
  let failOnDueSoon = false;

  for (const arg of args) {
    if (arg.startsWith("--as-of=")) {
      asOf = parseDate(arg.slice("--as-of=".length));
      continue;
    }
    if (arg.startsWith("--warn-days=")) {
      warnDays = Number(arg.slice("--warn-days=".length));
      if (!Number.isInteger(warnDays) || warnDays < 0) {
        throw new Error("--warn-days must be a non-negative integer");
      }
      continue;
    }
    if (arg === "--fail-on-overdue") {
      failOnOverdue = true;
      continue;
    }
    if (arg === "--fail-on-due") {
      failOnDue = true;
      continue;
    }
    if (arg === "--fail-on-due-soon") {
      failOnDueSoon = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { asOf, warnDays, failOnOverdue, failOnDue, failOnDueSoon };
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date ${value}; expected YYYY-MM-DD`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (dateKey(date) !== value) {
    throw new Error(`Invalid date ${value}; expected a real calendar date`);
  }
  return date;
}

function todayUtcDate(): Date {
  return parseDate(new Date().toISOString().slice(0, 10));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function label(status: ClassifiedResidual["reviewStatus"]): string {
  switch (status) {
    case "overdue":
      return "OVERDUE";
    case "due_today":
      return "DUE";
    case "due_soon":
      return "SOON";
    case "future":
      return "FUTURE";
  }
}

function read(file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

main();

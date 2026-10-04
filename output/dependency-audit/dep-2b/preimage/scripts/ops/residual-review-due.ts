import { pathToFileURL } from "node:url";
import {
  effectiveExceptionStatus,
  effectiveExecutableNow,
  isAcceptedExceptionEffective,
  readResidualLedgerV2,
  type EffectiveExceptionStatus,
  type ResidualItemV2,
} from "../quality/residual-ledger-common";

type ClassifiedResidual = Omit<ResidualItemV2, "executableNow"> & {
  executableNow: boolean;
  effectiveExceptionStatus: EffectiveExceptionStatus;
  acceptedExceptionEffective: boolean;
  daysUntilReview: number;
  reviewStatus: "overdue" | "due_today" | "due_soon" | "future";
};

export type Options = {
  asOf: Date;
  warnDays: number;
  failOnOverdue: boolean;
  failOnDue: boolean;
  failOnDueSoon: boolean;
};

const ledgerPath = "docs/development/residual-risk-ledger.json";

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const output = buildResidualReviewDue(options);
  const overdue = output.dueItems.filter((item) => item.reviewStatus === "overdue");
  const dueToday = output.dueItems.filter((item) => item.reviewStatus === "due_today");
  const dueSoon = output.dueItems.filter((item) => item.reviewStatus === "due_soon");

  for (const item of output.dueItems) {
    console.log(`${label(item.reviewStatus)} ${item.id}: reviewAt=${item.reviewAt}; daysUntil=${item.daysUntilReview}; owner=${item.ownerSkills.join(", ")}`);
  }
  for (const item of output.nonEffectiveAcceptedExceptionItems) {
    console.log(`ATTENTION ${item.id}: acceptedException=${item.effectiveExceptionStatus}; reviewAt=${item.reviewAt}; owner=${item.ownerSkills.join(", ")}`);
  }
  console.log(JSON.stringify(output, null, 2));

  if (output.gate.failed) {
    console.error(
      `residual review due failed: overdue=${overdue.length}; dueToday=${dueToday.length}; dueSoon=${dueSoon.length}.`,
    );
    process.exit(1);
  }
}

export function buildResidualReviewDue(options: Options, root = process.cwd()) {
  const ledger = readResidualLedgerV2({ root, file: ledgerPath, now: options.asOf });
  const items = ledger.items.map((item) => classifyResidual(item, options, root));
  const overdue = items.filter((item) => item.reviewStatus === "overdue");
  const dueToday = items.filter((item) => item.reviewStatus === "due_today");
  const dueSoon = items.filter((item) => item.reviewStatus === "due_soon");
  const shouldFail =
    (options.failOnOverdue && overdue.length > 0) ||
    (options.failOnDue && (overdue.length > 0 || dueToday.length > 0)) ||
    (options.failOnDueSoon && (overdue.length > 0 || dueToday.length > 0 || dueSoon.length > 0));

  return {
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
    nonEffectiveAcceptedExceptionItems: items
      .filter(isNonEffectiveAcceptedException)
      .map((item) => ({
        id: item.id,
        reviewAt: item.reviewAt,
        effectiveExceptionStatus: item.effectiveExceptionStatus,
        ownerSkills: item.ownerSkills,
        closeCondition: item.closeCondition,
        requiredEvidence: item.requiredEvidence,
      })),
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
}

function classifyResidual(item: ResidualItemV2, options: Options, root: string): ClassifiedResidual {
  const reviewDate = parseDate(item.reviewAt);
  const daysUntilReview = Math.round((reviewDate.getTime() - options.asOf.getTime()) / 86_400_000);
  return {
    ...item,
    executableNow: effectiveExecutableNow(item, { root, now: options.asOf }),
    effectiveExceptionStatus: effectiveExceptionStatus(item, options.asOf),
    acceptedExceptionEffective: isAcceptedExceptionEffective(item, options.asOf),
    daysUntilReview,
    reviewStatus: reviewStatus(daysUntilReview, options.warnDays),
  };
}

function isNonEffectiveAcceptedException(item: ClassifiedResidual): boolean {
  return item.type === "accepted-exception" && !item.acceptedExceptionEffective;
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL residual review due: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

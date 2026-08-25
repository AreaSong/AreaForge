import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  formatBytes,
  formatClockDuration,
  formatDate,
  formatDateRange,
  formatDateKey,
  formatDateMonthDay,
  formatDateMonthDayPadded,
  formatDatePadded,
  formatDateMedium,
  formatDateTime,
  formatDateTimeShort,
  formatDuration,
  formatClockTime,
  formatClockTimeMillis,
  formatMinutes,
  formatPercent,
  formatShortDuration,
  formatShortTime,
  formatTaskStatus,
  formatWeekday,
  isoToShanghaiDateInput,
  isoToShanghaiDateTimeInput,
  isShanghaiDateInputError,
  isValidShanghaiDateInput,
  isValidShanghaiDateRangeInput,
  shanghaiDateInputToIso,
  shanghaiDateRangeInputToIso,
  shanghaiDateTimeInputToIso,
  shiftShanghaiDateInput,
} from "@/lib/formatters";

test("date formatters use the Shanghai calendar and keep date-time semantics explicit", () => {
  const instant = "2026-08-20T01:02:03.000Z";
  assert.equal(formatDate(instant), "2026/8/20");
  assert.equal(formatDateTime(instant), "2026/8/20 09:02:03");
  assert.equal(formatDateMonthDay(instant), "8/20");
  assert.equal(formatDateMonthDayPadded(instant), "08/20");
  assert.equal(formatDatePadded(instant), "2026/08/20");
  assert.equal(formatDateMedium(instant), "2026年8月20日");
  assert.equal(formatDateTimeShort(instant), "2026/8/20 09:02");
  assert.equal(formatDateKey(instant), "2026-08-20");
  assert.equal(formatDateKey("2026-08-19T23:30:00.000Z"), "2026-08-20");
  assert.equal(formatWeekday(instant), "周四");
  assert.equal(formatClockTime(instant), "09:02:03");
  assert.equal(formatClockTimeMillis(instant), "09:02:03.000");
  assert.equal(formatShortTime(instant), "09:02");
});

test("numeric formatters keep ratios, minute totals, and second durations distinct", () => {
  assert.equal(formatPercent(0.126), "13%");
  assert.equal(formatMinutes(65), "65 分");
  assert.equal(formatDuration(65), "1 分 5 秒");
  assert.equal(formatDuration(45), "45 秒");
  assert.equal(formatClockDuration(3661), "01:01:01");
  assert.equal(formatShortDuration(65), "01:05");
});

test("byte formatter keeps empty values explicit and uses stable units", () => {
  assert.equal(formatBytes(null), "未记录");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
});

test("date input helpers keep Shanghai editing semantics independent from the host timezone", () => {
  assert.equal(shanghaiDateInputToIso("2026-08-21"), "2026-08-20T16:00:00.000Z");
  assert.equal(shanghaiDateTimeInputToIso("2026-08-21T08:30"), "2026-08-21T00:30:00.000Z");
  assert.equal(shanghaiDateTimeInputToIso("2026-08-21T08:30:45"), "2026-08-21T00:30:45.000Z");
  assert.equal(isoToShanghaiDateInput("2026-08-20T16:00:00.000Z"), "2026-08-21");
  assert.equal(isoToShanghaiDateTimeInput("2026-08-20T16:30:59.000Z"), "2026-08-21T00:30");
  assert.throws(() => shanghaiDateInputToIso("2026-02-30"), /INVALID_SHANGHAI_DATE_PARTS/);
  assert.throws(() => shanghaiDateTimeInputToIso("2026-08-21 08:30"), /INVALID_SHANGHAI_DATE_TIME_INPUT/);
  assert.throws(() => isoToShanghaiDateTimeInput("not-a-date"), isShanghaiDateInputError);
  assert.equal(shiftShanghaiDateInput("2026-02-28", 1), "2026-03-01");
  assert.equal(shiftShanghaiDateInput("2028-02-28", 1), "2028-02-29");
  assert.equal(shiftShanghaiDateInput("2026-12-31", 1), "2027-01-01");
  assert.equal(isValidShanghaiDateInput("2028-02-29"), true);
  assert.equal(isValidShanghaiDateInput("2027-02-29"), false);
  assert.equal(isValidShanghaiDateRangeInput("2026-08-20", "2026-08-21"), true);
  assert.equal(isValidShanghaiDateRangeInput("2026-08-21", "2026-08-20"), false);
  assert.deepEqual(shanghaiDateRangeInputToIso("2026-08-20", "2026-08-21"), {
    start: "2026-08-19T16:00:00.000Z",
    end: "2026-08-20T16:00:00.000Z",
  });
  assert.throws(() => shanghaiDateRangeInputToIso("2026-08-21", "2026-08-20"), isShanghaiDateInputError);
  assert.throws(() => shiftShanghaiDateInput("2026-02-30", 1), isShanghaiDateInputError);
});

test("Shanghai date input helpers do not depend on the process timezone", () => {
  const moduleUrl = pathToFileURL(resolve(process.cwd(), "lib/formatters.ts")).href;
  const source = [
    `import { isoToShanghaiDateInput, shanghaiDateInputToIso, shiftShanghaiDateInput } from ${JSON.stringify(moduleUrl)};`,
    "console.log(JSON.stringify([isoToShanghaiDateInput('2026-08-20T16:00:00.000Z'), shanghaiDateInputToIso('2026-08-21'), shiftShanghaiDateInput('2026-12-31', 1)]));",
  ].join("\n");
  const results = ["UTC", "America/Los_Angeles", "Asia/Tokyo"].map((timezone) => {
    const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, TZ: timezone },
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  });
  assert.deepEqual(new Set(results), new Set([
    '["2026-08-21","2026-08-20T16:00:00.000Z","2027-01-01"]',
  ]));
});

test("shared semantic labels keep ranges stable and expose unknown task states", () => {
  assert.equal(
    formatDateRange("2026-08-20T16:00:00.000Z", "2026-08-21T16:00:00.000Z"),
    "2026/8/21 至 2026/8/22",
  );
  assert.equal(formatTaskStatus("todo"), "待开始");
  assert.equal(formatTaskStatus("in_progress"), "进行中");
  assert.equal(formatTaskStatus("done"), "已完成");
  assert.equal(formatTaskStatus("skipped"), "已放弃");
  assert.equal(formatTaskStatus("deferred"), "已延期");
  if (false) {
    // @ts-expect-error 非 canonical 状态必须在 DTO 边界被拒绝。
    formatTaskStatus("IN_PROGRESS");
    // @ts-expect-error 未知状态不能绕过穷尽检查。
    formatTaskStatus("future_state");
  }
});

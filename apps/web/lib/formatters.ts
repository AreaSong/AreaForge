import type { TaskStatusDto } from "@/lib/contracts";

const LOCALE = "zh-CN";
const TIME_ZONE = "Asia/Shanghai";
const DATE_KEY_LOCALE = "en-CA";

const HUMAN_DATE_OPTIONS = { timeZone: TIME_ZONE } as const;
const HUMAN_DATE_TIME_OPTIONS = { hour12: false, timeZone: TIME_ZONE } as const;
const MONTH_DAY_OPTIONS = { month: "numeric", day: "numeric", timeZone: TIME_ZONE } as const;
const PADDED_DATE_OPTIONS = { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE } as const;
const PADDED_MONTH_DAY_OPTIONS = { month: "2-digit", day: "2-digit", timeZone: TIME_ZONE } as const;
const WEEKDAY_OPTIONS = { weekday: "short", timeZone: TIME_ZONE } as const;
const CLOCK_TIME_OPTIONS = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: TIME_ZONE } as const;
const CLOCK_TIME_MILLIS_OPTIONS = { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23", timeZone: TIME_ZONE } as const;
const SHORT_TIME_OPTIONS = { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIME_ZONE } as const;
const MEDIUM_DATE_OPTIONS = { dateStyle: "medium", timeZone: TIME_ZONE } as const;
const SHORT_DATE_TIME_OPTIONS = { dateStyle: "short", timeStyle: "short", timeZone: TIME_ZONE } as const;
const DATE_KEY_OPTIONS = { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE } as const;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export type DateValue = Date | number | string;

export function formatDate(value: DateValue): string {
  return toDate(value).toLocaleDateString(LOCALE, HUMAN_DATE_OPTIONS);
}

export function formatDateTime(value: DateValue): string {
  return toDate(value).toLocaleString(LOCALE, HUMAN_DATE_TIME_OPTIONS);
}

export function formatDateMonthDay(value: DateValue): string {
  return toDate(value).toLocaleDateString(LOCALE, MONTH_DAY_OPTIONS);
}

export function formatDatePadded(value: DateValue): string {
  return toDate(value).toLocaleDateString(LOCALE, PADDED_DATE_OPTIONS);
}

export function formatDateMonthDayPadded(value: DateValue): string {
  return toDate(value).toLocaleDateString(LOCALE, PADDED_MONTH_DAY_OPTIONS);
}

export function formatWeekday(value: DateValue): string {
  return toDate(value).toLocaleDateString(LOCALE, WEEKDAY_OPTIONS);
}

export function formatClockTime(value: DateValue): string {
  return toDate(value).toLocaleTimeString(LOCALE, CLOCK_TIME_OPTIONS);
}

export function formatClockTimeMillis(value: DateValue): string {
  return toDate(value).toLocaleTimeString(LOCALE, CLOCK_TIME_MILLIS_OPTIONS);
}

export function formatShortTime(value: DateValue): string {
  return toDate(value).toLocaleTimeString(LOCALE, SHORT_TIME_OPTIONS);
}

export function formatDateMedium(value: DateValue): string {
  return toDate(value).toLocaleDateString(LOCALE, MEDIUM_DATE_OPTIONS);
}

export function formatDateTimeShort(value: DateValue): string {
  return toDate(value).toLocaleString(LOCALE, SHORT_DATE_TIME_OPTIONS);
}

export function formatDateKey(value: DateValue): string {
  return toDate(value).toLocaleDateString(DATE_KEY_LOCALE, DATE_KEY_OPTIONS);
}

/** 将 HTML date 输入解释为上海自然日零点，而不是运行浏览器所在时区的零点。 */
export function shanghaiDateInputToIso(value: string): string {
  const match = DATE_INPUT_PATTERN.exec(value);
  if (!match) throw new RangeError("INVALID_SHANGHAI_DATE_INPUT");
  const [, year, month, day] = match;
  return shanghaiPartsToIso(Number(year), Number(month), Number(day), 0, 0, 0);
}

/** 校验 HTML date 输入是否表示一个真实的上海自然日。 */
export function isValidShanghaiDateInput(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    shanghaiDateInputToIso(value);
    return true;
  } catch (caught) {
    if (isShanghaiDateInputError(caught)) return false;
    throw caught;
  }
}

/** 校验闭区间日期输入；起点晚于终点时视为非法。 */
export function isValidShanghaiDateRangeInput(start: unknown, end: unknown): boolean {
  return isValidShanghaiDateInput(start)
    && isValidShanghaiDateInput(end)
    && start <= end;
}

/** 将上海自然日闭区间转换为两个 ISO 时间点，并拒绝反向区间。 */
export function shanghaiDateRangeInputToIso(start: string, end: string): { start: string; end: string } {
  const startIso = shanghaiDateInputToIso(start);
  const endIso = shanghaiDateInputToIso(end);
  if (start > end) throw new RangeError("INVALID_SHANGHAI_DATE_RANGE");
  return { start: startIso, end: endIso };
}

/** 将 HTML datetime-local 输入解释为上海本地时间。 */
export function shanghaiDateTimeInputToIso(value: string): string {
  const match = DATE_TIME_INPUT_PATTERN.exec(value);
  if (!match) throw new RangeError("INVALID_SHANGHAI_DATE_TIME_INPUT");
  const [, year, month, day, hour, minute, second = "0"] = match;
  return shanghaiPartsToIso(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

/** 将时间点投影为上海时区的 HTML date 输入值。 */
export function isoToShanghaiDateInput(value: DateValue): string {
  return formatDateKey(toValidDate(value));
}

/** 将时间点投影为上海时区的 HTML datetime-local 输入值。 */
export function isoToShanghaiDateTimeInput(value: DateValue): string {
  const date = toValidDate(value);
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return [
    shifted.getUTCFullYear(),
    padDatePart(shifted.getUTCMonth() + 1),
    padDatePart(shifted.getUTCDate()),
  ].join("-") + `T${padDatePart(shifted.getUTCHours())}:${padDatePart(shifted.getUTCMinutes())}`;
}

export function formatDateRange(start: DateValue, end: DateValue): string {
  return `${formatDate(start)} 至 ${formatDate(end)}`;
}

/** 只接受浏览器 DTO 的 canonical 小写状态；数据库状态在服务边界归一化。 */
const TASK_STATUS_LABELS = {
  todo: "待开始",
  in_progress: "进行中",
  done: "已完成",
  skipped: "已放弃",
  deferred: "已延期",
} satisfies Record<TaskStatusDto, string>;

export function formatTaskStatus(status: TaskStatusDto): string {
  return TASK_STATUS_LABELS[status];
}

export function isShanghaiDateInputError(value: unknown): value is RangeError {
  return value instanceof RangeError && value.message.startsWith("INVALID_SHANGHAI_DATE_");
}

/** 按上海自然日移动 HTML date 输入，不受宿主时区或夏令时影响。 */
export function shiftShanghaiDateInput(value: string, days: number): string {
  const match = DATE_INPUT_PATTERN.exec(value);
  if (!match || !Number.isInteger(days)) throw new RangeError("INVALID_SHANGHAI_DATE_INPUT");
  const [, year, month, day] = match;
  shanghaiPartsToIso(Number(year), Number(month), Number(day), 0, 0, 0);
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
  return [
    shifted.getUTCFullYear(),
    padDatePart(shifted.getUTCMonth() + 1),
    padDatePart(shifted.getUTCDate()),
  ].join("-");
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatMinutes(value: number): string {
  return `${value} 分`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes} 分 ${remainder} 秒` : `${remainder} 秒`;
}

/** 固定时钟显示，适用于专注计时和活动状态栏。 */
export function formatClockDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainder = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

/** 紧凑计时显示，适用于复习结果和列表行。 */
export function formatShortDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function formatBytes(value: number | null, emptyLabel = "未记录"): string {
  if (value === null || !Number.isFinite(value) || value < 0) return emptyLabel;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function toDate(value: DateValue): Date {
  return value instanceof Date ? value : new Date(value);
}

function toValidDate(value: DateValue): Date {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("INVALID_SHANGHAI_DATE_VALUE");
  return date;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function shanghaiPartsToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string {
  const utcTime = Date.UTC(year, month - 1, day, hour, minute, second) - SHANGHAI_OFFSET_MS;
  const instant = new Date(utcTime);
  const shifted = new Date(instant.getTime() + SHANGHAI_OFFSET_MS);
  if (
    shifted.getUTCFullYear() !== year
    || shifted.getUTCMonth() !== month - 1
    || shifted.getUTCDate() !== day
    || shifted.getUTCHours() !== hour
    || shifted.getUTCMinutes() !== minute
    || shifted.getUTCSeconds() !== second
  ) {
    throw new RangeError("INVALID_SHANGHAI_DATE_PARTS");
  }
  return instant.toISOString();
}

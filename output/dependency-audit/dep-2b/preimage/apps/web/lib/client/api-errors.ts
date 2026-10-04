/**
 * The transport result shape accepted by the client-side error readers.
 *
 * Keeping this small and structural lets the helpers consume `ApiResult`
 * without importing the transport module (and without coupling them to a
 * particular endpoint response type).
 */
export interface ApiErrorSource {
  status: number;
  body?: unknown | null;
}

export type FieldErrors = Record<string, string[]>;

export type ApiFailureKind = "unauthorized" | "conflict" | "field" | "server" | "unknown";

export interface ApiFailureClassification {
  kind: ApiFailureKind;
  status: number | null;
  code: string | null;
  conflictFields: string[];
  fieldErrors: FieldErrors;
}

/** Identify an authentication boundary from HTTP status only. */
export function isUnauthorized(source: ApiErrorSource | null | undefined): boolean {
  return source?.status === 401;
}

/** Identify an optimistic-concurrency boundary from HTTP status only. */
export function isConflict(source: ApiErrorSource | null | undefined): boolean {
  return source?.status === 409;
}

/**
 * Classify transport failures without deciding how a domain should recover.
 * A conflict remains a conflict even when the payload also contains fields;
 * the domain owns the merge/retry decision and can still read `latest`.
 */
export function classifyApiFailure(source: ApiErrorSource | null | undefined): ApiFailureClassification {
  const status = typeof source?.status === "number" ? source.status : null;
  const code = readErrorMessage(source);
  const conflictFields = readConflictFields(source);
  const fieldErrors = readFieldErrors(source);
  const kind: ApiFailureKind = isUnauthorized(source)
    ? "unauthorized"
    : isConflict(source)
      ? "conflict"
      : Object.keys(fieldErrors).length > 0
        ? "field"
        : code !== null || (status !== null && status >= 500)
          ? "server"
          : "unknown";
  return { kind, status, code, conflictFields, fieldErrors };
}

/** Read the server error code without assigning UI or domain semantics. */
export function readErrorMessage(source: ApiErrorSource | null | undefined): string | null {
  const body = asRecord(source?.body);
  const error = body?.error;
  return typeof error === "string" && error.length > 0 ? error : null;
}

/** Read conflict field names from either the top-level or flattened details. */
export function readConflictFields(source: ApiErrorSource | null | undefined): string[] {
  const body = asRecord(source?.body);
  const topLevel = readStringArray(body?.conflictFields);
  const details = asRecord(body?.details);
  const nested = readStringArray(details?.conflictFields);
  return topLevel.length > 0 ? topLevel : nested;
}

/**
 * Read Zod-style field errors while tolerating malformed, empty, or scalar
 * response bodies.  The returned object is newly allocated on every call.
 */
export function readFieldErrors(source: ApiErrorSource | null | undefined): FieldErrors {
  const body = asRecord(source?.body);
  const details = asRecord(body?.details);
  const fieldErrors = {
    ...readFieldErrorRecord(details?.fieldErrors),
    ...readFieldErrorRecord(body?.fieldErrors),
  };
  return fieldErrors;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readFieldErrorRecord(value: unknown): FieldErrors {
  const record = asRecord(value);
  if (!record) return {};

  const result: FieldErrors = {};
  for (const [field, messages] of Object.entries(record)) {
    // Avoid assigning prototype keys from untrusted JSON into a plain object.
    if (field === "__proto__" || field === "constructor" || field === "prototype") continue;
    const parsed = readStringArray(messages);
    if (Array.isArray(messages)) result[field] = parsed;
  }
  return result;
}

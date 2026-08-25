export async function readApiJson(response: Response): Promise<unknown | null> {
  // A Response body is a one-shot stream.  Treat an already-consumed body as
  // an empty parse instead of surfacing a second-consumption exception.
  if (response.bodyUsed) return null;
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

export interface ApiJsonResult<T> {
  response: Response;
  body: T | null;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  headers: Headers;
  body: T | null;
}

/** Common shape returned by API error responses; `latest` stays endpoint-specific. */
export interface ApiErrorEnvelope<TLatest = never> {
  error?: string;
  conflictFields?: string[];
  workbench?: string;
  latest?: TLatest;
}

export interface ApiBlobResult<TError = unknown> {
  ok: boolean;
  status: number;
  headers: Headers;
  blob: Blob | null;
  body: TError | null;
}

/**
 * Shared browser transport. Keeping the raw Response alongside the parsed
 * body lets feature adapters preserve status-specific behavior (for example
 * revision conflicts) without duplicating response parsing.
 */
export async function requestApiJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiJsonResult<T>> {
  const response = await fetch(input, init);
  return {
    response,
    body: await readApiJson(response) as T | null,
  };
}

/**
 * Browser-facing result shape. Endpoint adapters can retain status-specific
 * behavior without leaking the Fetch API into feature components.
 */
export async function requestApiResult<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const result = await requestApiJson<T>(input, init);
  return {
    ok: result.response.ok,
    status: result.response.status,
    headers: result.response.headers,
    body: result.body,
  };
}

/**
 * Execute a request whose success body is binary and whose failure body is
 * JSON.  Each response stream is consumed exactly once: `blob()` for a
 * successful response and the shared safe JSON reader for an error response.
 */
export async function requestApiBlob<TError = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiBlobResult<TError>> {
  const response = await fetch(input, init);
  if (response.ok) {
    return {
      ok: true,
      status: response.status,
      headers: response.headers,
      blob: await response.blob(),
      body: null,
    };
  }
  return {
    ok: false,
    status: response.status,
    headers: response.headers,
    blob: null,
    body: await readApiJson(response) as TError | null,
  };
}

/** Build a JSON request while preserving caller-provided headers and options. */
export function createJsonRequest(
  method: string,
  body: unknown,
  init: Omit<RequestInit, "method" | "body"> = {},
): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return {
    ...init,
    method,
    headers,
    body: JSON.stringify(body),
  };
}

export class ApiClientError<T = unknown> extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: T | null,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** Execute a JSON request and fail with a typed transport error on non-2xx. */
export async function requestApi<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const result = await requestApiJson<T>(input, init);
  if (!result.response.ok) {
    const body = result.body as (T & { error?: unknown }) | null;
    const message = typeof body?.error === "string" ? body.error : `HTTP_${result.response.status}`;
    throw new ApiClientError(message, result.response.status, result.body);
  }
  return result.body as T;
}

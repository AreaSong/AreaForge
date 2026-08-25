import type { AutoApplyPolicy, UpdateAction, UpdateCenterStatus } from "@/lib/system/update-center";
import { ApiClientError, requestApi, requestApiJson } from "./client";

const UPDATE_STATUS_PATH = "/api/system/update-status";
const UPDATE_REQUESTS_PATH = "/api/system/update-requests";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 12;

type UpdateOperation = NonNullable<UpdateCenterStatus["lastOperation"]>;

interface UpdateStatusResponse {
  status?: UpdateCenterStatus;
  error?: string;
}

export interface SystemUpdateRequestPayload {
  action: UpdateAction;
  autoApply?: AutoApplyPolicy;
  confirmedSnapshotHash?: string;
  idempotencyKey: string;
  tag?: string;
}

export interface SystemUpdateRequestResponse {
  request?: UpdateOperation;
  error?: string;
}

export interface SystemUpdateRequestResult {
  responseOk: boolean;
  responseStatus: number;
  responseBody: SystemUpdateRequestResponse | null;
  request: UpdateOperation | null;
  errorCode: string | null;
}

export class SystemUpdateApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly kind: "network" | "response",
    public readonly status: number | null,
    public readonly body: unknown | null,
  ) {
    super(code);
    this.name = "SystemUpdateApiError";
  }
}

export async function readSystemUpdateStatus(signal?: AbortSignal): Promise<UpdateCenterStatus> {
  try {
    const body = await requestApi<UpdateStatusResponse>(UPDATE_STATUS_PATH, { cache: "no-store", signal });
    if (!body?.status) {
      throw new SystemUpdateApiError("STATUS_RESPONSE_INVALID", "response", 200, body ?? null);
    }
    return body.status;
  } catch (error) {
    throw normalizeSystemUpdateError(error, "STATUS_FAILED");
  }
}

export async function submitSystemUpdateRequest(
  payload: SystemUpdateRequestPayload,
): Promise<SystemUpdateRequestResult> {
  try {
    const { response, body } = await requestApiJson<SystemUpdateRequestResponse>(UPDATE_REQUESTS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const request = body?.request ?? null;
    return {
      responseOk: response.ok,
      responseStatus: response.status,
      responseBody: body,
      request,
      errorCode: response.ok
        ? request ? null : "REQUEST_RESPONSE_INVALID"
        : apiErrorCode(body, "REQUEST_FAILED"),
    };
  } catch (error) {
    throw normalizeSystemUpdateError(error, "REQUEST_FAILED");
  }
}

export interface SystemUpdateStatusPollingOptions<Snapshot = UpdateCenterStatus> {
  readStatus?: (signal: AbortSignal) => Promise<Snapshot>;
  onStatus: (status: Snapshot) => void;
  shouldContinue: (status: Snapshot) => boolean;
  onError?: (error: SystemUpdateApiError) => void;
  onExhausted?: (lastError: SystemUpdateApiError | null) => void;
  initialDelayMs?: number;
  intervalMs?: number;
  maxAttempts?: number;
}

export function startSystemUpdateStatusPolling<Snapshot = UpdateCenterStatus>(
  options: SystemUpdateStatusPollingOptions<Snapshot>,
): () => void {
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_POLL_INTERVAL_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  let attempts = 0;
  let cancelled = false;
  let exhausted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | null = null;

  const markExhausted = (lastError: SystemUpdateApiError | null) => {
    if (cancelled || exhausted) return;
    exhausted = true;
    options.onExhausted?.(lastError);
  };

  const schedule = (delayMs: number) => {
    if (cancelled || exhausted) return;
    if (attempts >= maxAttempts) {
      markExhausted(null);
      return;
    }
    timer = setTimeout(poll, delayMs);
  };

  const poll = async () => {
    if (cancelled || attempts >= maxAttempts) return;
    attempts += 1;
    inFlight = new AbortController();
    try {
      const status = options.readStatus
        ? await options.readStatus(inFlight.signal)
        : await readSystemUpdateStatus(inFlight.signal) as Snapshot;
      if (cancelled) return;
      options.onStatus(status);
      if (options.shouldContinue(status)) {
        if (attempts >= maxAttempts) markExhausted(null);
        else schedule(intervalMs);
      }
    } catch (error) {
      if (cancelled) return;
      const normalized = normalizeSystemUpdateError(error, "STATUS_FAILED");
      options.onError?.(normalized);
      if (isRetryableSystemUpdateError(normalized)) {
        if (attempts >= maxAttempts) markExhausted(normalized);
        else schedule(intervalMs);
      }
    } finally {
      inFlight = null;
    }
  };

  schedule(initialDelayMs);
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    inFlight?.abort();
  };
}

export function isSystemUpdateNetworkError(error: unknown): boolean {
  return error instanceof SystemUpdateApiError && error.kind === "network";
}

export function isRetryableSystemUpdateError(error: unknown): boolean {
  if (!(error instanceof SystemUpdateApiError)) return false;
  return error.kind === "network"
    || error.status === 408
    || error.status === 429
    || (typeof error.status === "number" && error.status >= 500);
}

export function systemUpdateErrorCode(error: unknown, fallback: string): string {
  return error instanceof SystemUpdateApiError ? error.code : fallback;
}

function normalizeSystemUpdateError(error: unknown, fallback: string): SystemUpdateApiError {
  if (error instanceof SystemUpdateApiError) return error;
  if (error instanceof ApiClientError) {
    return new SystemUpdateApiError(
      apiErrorCode(error.body, fallback),
      "response",
      error.status,
      error.body,
    );
  }
  return new SystemUpdateApiError(fallback, "network", null, null);
}

function apiErrorCode(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fallback;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" && error.length > 0 ? error : fallback;
}

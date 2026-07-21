import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
}

export function badRequestResponse(error: string, details?: unknown): NextResponse {
  return NextResponse.json({ error, details }, { status: 400 });
}

export function zodErrorResponse(error: ZodError): NextResponse {
  return badRequestResponse("INVALID_REQUEST", error.flatten());
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    public readonly details?: { latest?: unknown; conflictFields?: string[] },
  ) {
    super(code);
  }
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    const body: { error: string; latest?: unknown; conflictFields?: string[] } = { error: error.code };
    if (error.details?.latest !== undefined) body.latest = error.details.latest;
    if (error.details?.conflictFields) body.conflictFields = error.details.conflictFields;
    return NextResponse.json(body, { status: error.status });
  }

  const errorId = randomUUID();
  console.error("API internal error", {
    errorId,
    errorType: error instanceof Error ? error.constructor.name : typeof error,
  });
  return NextResponse.json({ error: "INTERNAL_ERROR", errorId }, { status: 500 });
}

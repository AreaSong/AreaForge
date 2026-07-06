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
  ) {
    super(code);
  }
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.code }, { status: error.status });
  }

  console.error(error);
  return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}

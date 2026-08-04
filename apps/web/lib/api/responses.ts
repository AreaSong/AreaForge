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
    public readonly details?: { latest?: unknown; conflictFields?: string[]; workbench?: string },
  ) {
    super(code);
  }
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    const body: { error: string; latest?: unknown; conflictFields?: string[]; workbench?: string } = { error: error.code };
    if (error.details?.latest !== undefined) body.latest = error.details.latest;
    if (error.details?.conflictFields) body.conflictFields = error.details.conflictFields;
    if (error.details?.workbench) body.workbench = error.details.workbench;
    else if (error.status === 404 || error.status === 409) body.workbench = workbenchForError(error.code);
    return NextResponse.json(body, { status: error.status });
  }

  const errorId = randomUUID();
  const errorMessage = error instanceof Error ? error.message : "unknown error";
  console.error(
    process.env.NODE_ENV === "production"
      ? `API internal error ${errorId} (${error instanceof Error ? error.constructor.name : typeof error})`
      : `API internal error ${errorId} (${error instanceof Error ? error.constructor.name : typeof error}): ${errorMessage}`,
  );
  return NextResponse.json({ error: "INTERNAL_ERROR", errorId }, { status: 500 });
}

function workbenchForError(code: string): string {
  if (code.includes("PLAN_INBOX")) return "/roadmap/allocation/drafts";
  if (code.includes("TASK") || code.includes("SESSION") || code.includes("RECOVERY")) return "/today";
  if (code.includes("REPORT")) return "/roadmap/reviews";
  if (code.includes("SIMULATION")) return "/test/simulations";
  if (code.includes("STAGE") || code.includes("MILESTONE")) return "/roadmap/stages";
  if (code.includes("REVIEW_EVENT") || code.includes("REVIEW_SCHEDULE") || code.includes("REVIEW_TARGET")) {
    return "/knowledge/reviews";
  }
  if (code.includes("LEARNING_TREE") || code.includes("ROOT_NODE")) return "/knowledge/imports";
  if (code.includes("SYLLABUS")) return "/knowledge/syllabi";
  if (code.includes("MISTAKE")) return "/knowledge/mistakes";
  if (code.includes("NOTE")) return "/knowledge/cards";
  if (code.includes("RESOURCE") || code.includes("ATTACHMENT")) return "/knowledge/resources";
  if (code.includes("CANVAS")) return "/knowledge/canvas";
  if (code.includes("MOTIVATION") || code.includes("VAULT")) return "/settings/profile";
  if (code.includes("NOTIFICATION")) return "/settings/learning";
  if (code.includes("WORKSPACE") || code.includes("SUBJECT") || code.includes("GROUP")) return "/settings/exams";
  return "/today";
}

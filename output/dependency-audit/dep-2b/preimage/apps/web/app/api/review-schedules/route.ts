import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  listReviewSchedules,
  materializeReviewSchedule,
} from "@/lib/study/review-schedule-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  targetType: z.enum(["NOTE", "MISTAKE", "STUDY_RESOURCE", "SYLLABUS_NODE"]),
  noteId: z.string().min(1).optional(),
  mistakeId: z.string().min(1).optional(),
  studyResourceId: z.string().min(1).optional(),
  syllabusNodeId: z.string().min(1).optional(),
  dueDate: z.string().min(1),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const status = request.nextUrl.searchParams.get("status");
    return NextResponse.json({
      schedules: await listReviewSchedules(user.id, {
        status: status === "ACTIVE" || status === "PAUSED" ? status : undefined,
      }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      schedule: await materializeReviewSchedule(user.id, parsed.data),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

import type { NextRequest } from "next/server";
import { getCurrentUserFromRequest, type CurrentUser } from "@/lib/auth/session";
import { ApiError } from "./responses";

export async function requireApiUser(request: NextRequest): Promise<CurrentUser> {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    throw new ApiError("UNAUTHORIZED", 401);
  }

  return user;
}

export async function readJson(request: NextRequest): Promise<unknown> {
  return request.json().catch(() => null);
}

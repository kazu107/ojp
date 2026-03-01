import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { HttpError, updateUserRoleByAdmin } from "@/lib/store";
import { UserRole } from "@/lib/types";

interface UpdateUserRoleRouteContext {
  params: Promise<{
    userId: string;
  }>;
}

function parseAssignableRole(raw: unknown): UserRole {
  const role = parseString(raw);
  if (role === "user" || role === "problem_author" || role === "contest_organizer") {
    return role;
  }
  throw new HttpError("role must be one of: user, problem_author, contest_organizer", 400);
}

export async function POST(request: Request, { params }: UpdateUserRoleRouteContext) {
  try {
    const { userId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const user = await updateUserRoleByAdmin(
      userId,
      parseAssignableRole(body.role),
      parseString(body.reason),
    );
    return NextResponse.json({ user });
  } catch (error) {
    return errorResponse(error, "failed to update user role");
  }
}

import { NextResponse } from "next/server";
import { parseOptionalString } from "@/lib/api-helpers";
import { updateCurrentUserProfile } from "@/lib/store";
import { errorResponse } from "@/lib/api-response";

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      displayName?: unknown;
      bio?: unknown;
    };
    const user = await updateCurrentUserProfile({
      displayName: parseOptionalString(body.displayName),
      bio: parseOptionalString(body.bio),
    });
    return NextResponse.json({ user });
  } catch (error) {
    return errorResponse(error, "failed to update profile");
  }
}

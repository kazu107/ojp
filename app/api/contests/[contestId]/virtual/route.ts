import { NextResponse } from "next/server";
import {
  finishVirtualContest,
  getVirtualParticipationForViewer,
  startVirtualContest,
} from "@/lib/store";
import { apiError, errorResponse } from "@/lib/api-response";

type Context = { params: Promise<{ contestId: string }> };
const headers = { "Cache-Control": "private, no-store" };
export async function GET(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      {
        session: await getVirtualParticipationForViewer(
          (await params).contestId,
        ),
      },
      { headers },
    );
  } catch (error) {
    return errorResponse(error, "failed to fetch virtual participation");
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const body = await request.json();
    const { contestId } = await params;
    if (body.action !== "start" && body.action !== "finish")
      return apiError(400, "Invalid virtual participation action.");
    const session =
      body.action === "start"
        ? await startVirtualContest(contestId)
        : await finishVirtualContest(contestId);
    return NextResponse.json({ session }, { headers });
  } catch (error) {
    return errorResponse(error, "failed to update virtual participation");
  }
}

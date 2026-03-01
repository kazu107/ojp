import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const [users, problems, contests, submissions, reports] = await Promise.all([
    prisma.user.count(),
    prisma.problem.count(),
    prisma.contest.count(),
    prisma.submission.count(),
    prisma.report.count(),
  ]);

  return NextResponse.json({
    ok: true,
    counts: {
      users,
      problems,
      contests,
      submissions,
      reports,
    },
  });
}

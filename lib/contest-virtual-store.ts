import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { VirtualParticipation } from "@/lib/types";
import type { ContestVirtualParticipation } from "@prisma/client";

function serialize(row: {
  id: string;
  contestId: string;
  userId: string;
  startedAt: Date;
  endAt: Date;
  finishedAt: Date | null;
}): VirtualParticipation {
  return {
    ...row,
    startedAt: row.startedAt.toISOString(),
    endAt: row.endAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export async function readVirtualParticipation(
  contestId: string,
  userId: string,
) {
  const row = await prisma.contestVirtualParticipation.findUnique({
    where: { contestId_userId: { contestId, userId } },
  });
  return row ? serialize(row) : null;
}

export async function startVirtualParticipation(
  contestId: string,
  userId: string,
  durationMs: number,
) {
  const now = new Date();
  // Empty Prisma upserts can race. A PostgreSQL conflict clause atomically returns the existing timer.
  const rows = await prisma.$queryRaw<ContestVirtualParticipation[]>`
    INSERT INTO "ContestVirtualParticipation" ("id", "contestId", "userId", "startedAt", "endAt")
    VALUES (${randomUUID()}, ${contestId}, ${userId}, ${now}, ${new Date(now.getTime() + durationMs)})
    ON CONFLICT ("contestId", "userId") DO UPDATE
      SET "contestId" = "ContestVirtualParticipation"."contestId"
    RETURNING *
  `;
  return serialize(rows[0]);
}

export async function finishVirtualParticipation(
  contestId: string,
  userId: string,
) {
  await prisma.contestVirtualParticipation.updateMany({
    where: { contestId, userId, finishedAt: null },
    data: { finishedAt: new Date() },
  });
  return readVirtualParticipation(contestId, userId);
}

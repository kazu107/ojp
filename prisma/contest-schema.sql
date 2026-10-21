BEGIN;
CREATE TABLE IF NOT EXISTS "ContestVirtualParticipation" (
  "id" TEXT PRIMARY KEY,
  "contestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContestVirtualParticipation_contestId_userId_key"
  ON "ContestVirtualParticipation" ("contestId", "userId");
CREATE INDEX IF NOT EXISTS "ContestVirtualParticipation_userId_startedAt_idx"
  ON "ContestVirtualParticipation" ("userId", "startedAt");
COMMIT;

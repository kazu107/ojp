-- Additive, idempotent; never replace or seed AppState.
CREATE TABLE IF NOT EXISTS "ProblemTags" (
  "problemId" TEXT PRIMARY KEY, "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "ProblemStudy" (
  "userId" TEXT NOT NULL, "problemId" TEXT NOT NULL,
  "bookmarked" BOOLEAN NOT NULL DEFAULT false, "review" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT NOT NULL DEFAULT '', "reviewAt" TIMESTAMP(3), "lastReviewedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "problemId")
);
CREATE INDEX IF NOT EXISTS "ProblemStudy_userId_review_reviewAt_idx" ON "ProblemStudy"("userId", "review", "reviewAt");
CREATE TABLE IF NOT EXISTS "ProblemRevision" (
  "id" TEXT PRIMARY KEY, "problemId" TEXT NOT NULL, "digest" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL, "summary" JSONB NOT NULL DEFAULT '{}', "storageKey" TEXT, "createdBy" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "ProblemRevision" ADD COLUMN IF NOT EXISTS "summary" JSONB NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS "ProblemRevision_problemId_digest_key" ON "ProblemRevision"("problemId", "digest");
CREATE INDEX IF NOT EXISTS "ProblemRevision_problemId_createdAt_idx" ON "ProblemRevision"("problemId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProblemRevision_storageKey_idx" ON "ProblemRevision"("storageKey");

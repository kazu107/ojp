-- Additive migration: existing scores and AppState are not rewritten.
CREATE TABLE IF NOT EXISTS "HeuristicRun" (
  "id" TEXT PRIMARY KEY, "submissionId" TEXT NOT NULL, "problemId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL, "evaluationId" TEXT, "phase" TEXT NOT NULL,
  "status" TEXT NOT NULL, "config" JSONB NOT NULL, "sourceCode" TEXT NOT NULL,
  "language" "Language" NOT NULL, "score" DECIMAL(48,12), "token" TEXT,
  "leaseUntil" TIMESTAMP(3), "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "HeuristicRun_submissionId_phase_evaluationId_key" ON "HeuristicRun"("submissionId","phase","evaluationId");
CREATE INDEX IF NOT EXISTS "HeuristicRun_status_createdAt_idx" ON "HeuristicRun"("status","createdAt");
CREATE INDEX IF NOT EXISTS "HeuristicRun_submissionId_createdAt_idx" ON "HeuristicRun"("submissionId","createdAt");
CREATE TABLE IF NOT EXISTS "HeuristicCaseScore" (
  "runId" TEXT NOT NULL REFERENCES "HeuristicRun"("id") ON DELETE CASCADE,
  "caseKey" TEXT NOT NULL, "groupName" TEXT NOT NULL, "caseName" TEXT NOT NULL,
  "verdict" TEXT NOT NULL, "rawScore" DECIMAL(48,12), "timeMs" INTEGER NOT NULL,
  "memoryKb" INTEGER NOT NULL, "diagnostic" TEXT NOT NULL,
  PRIMARY KEY ("runId","caseKey")
);
CREATE TABLE IF NOT EXISTS "HeuristicContest" (
  "contestId" TEXT PRIMARY KEY, "selection" TEXT NOT NULL, "revisions" JSONB NOT NULL,
  "evaluationId" TEXT, "finalSubmissionIds" JSONB, "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

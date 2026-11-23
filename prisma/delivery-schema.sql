-- Additive arena storage. Existing problem and submission tables are untouched.
CREATE TABLE IF NOT EXISTS "DeliveryBotVersion" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "language" "Language" NOT NULL, "sourceCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "validUntil" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "DeliveryBotVersion_userId_validUntil_createdAt_idx" ON "DeliveryBotVersion"("userId","validUntil","createdAt");
CREATE TABLE IF NOT EXISTS "DeliveryEvaluation" (
  "id" TEXT PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "kind" TEXT NOT NULL, "status" TEXT NOT NULL,
  "cutoff" TIMESTAMP(3) NOT NULL, "entries" JSONB NOT NULL, "standings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "publishedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "DeliveryEvaluation_status_createdAt_idx" ON "DeliveryEvaluation"("status","createdAt");
CREATE TABLE IF NOT EXISTS "DeliveryMatch" (
  "id" TEXT PRIMARY KEY, "evaluationId" TEXT REFERENCES "DeliveryEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ordinal" INTEGER NOT NULL, "ownerId" TEXT, "versionA" TEXT, "versionB" TEXT,
  "trialSource" JSONB, "rules" TEXT NOT NULL, "seed" INTEGER NOT NULL, "flipped" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0, "token" TEXT, "leaseUntil" TIMESTAMP(3),
  "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryMatch_evaluationId_ordinal_key" ON "DeliveryMatch"("evaluationId","ordinal");
CREATE INDEX IF NOT EXISTS "DeliveryMatch_status_createdAt_idx" ON "DeliveryMatch"("status","createdAt");
CREATE INDEX IF NOT EXISTS "DeliveryMatch_ownerId_createdAt_idx" ON "DeliveryMatch"("ownerId","createdAt");

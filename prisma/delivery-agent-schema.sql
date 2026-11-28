-- Optional agent integration. Existing player, trial, and ranking rows are untouched.
BEGIN;
CREATE TABLE IF NOT EXISTS "AgentAccessToken" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "label" TEXT NOT NULL,
  "digest" TEXT NOT NULL UNIQUE, "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "AgentAccessToken_ownerId_createdAt_idx" ON "AgentAccessToken"("ownerId","createdAt");
CREATE TABLE IF NOT EXISTS "AgentDeliveryTrial" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
  "sourceDigest" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentDeliveryTrial_ownerId_requestKey_key" ON "AgentDeliveryTrial"("ownerId","requestKey");
CREATE TABLE IF NOT EXISTS "AgentDeliveryDraft" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "tokenId" TEXT NOT NULL, "trialId" TEXT NOT NULL,
  "baselineVersionId" TEXT, "name" TEXT NOT NULL, "language" "Language" NOT NULL,
  "sourceCode" TEXT, "sourceDigest" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "appliedVersionId" TEXT, "appliedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "AgentDeliveryDraft_ownerId_createdAt_idx" ON "AgentDeliveryDraft"("ownerId","createdAt");
CREATE INDEX IF NOT EXISTS "AgentDeliveryDraft_tokenId_idx" ON "AgentDeliveryDraft"("tokenId");
COMMIT;

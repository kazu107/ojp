-- Stop arena writes before applying this migration. Existing evaluations/replays stay unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS "DeliveryLadderEntry" (
  "userId" TEXT PRIMARY KEY, "activeVersionId" TEXT, "activeName" TEXT NOT NULL, "state" TEXT NOT NULL,
  "rating" INTEGER NOT NULL DEFAULT 1500, "deviation" INTEGER NOT NULL DEFAULT 320,
  "sets" INTEGER NOT NULL DEFAULT 0, "cleanGames" INTEGER NOT NULL DEFAULT 0,
  "rankedVersionId" TEXT, "rankedName" TEXT, "rankedRating" INTEGER NOT NULL DEFAULT 1500,
  "rankedDeviation" INTEGER NOT NULL DEFAULT 320, "rankedScore" INTEGER NOT NULL DEFAULT 1180,
  "rankedSets" INTEGER NOT NULL DEFAULT 0, "dueAt" TIMESTAMP(3) NOT NULL, "availableAt" TIMESTAMP(3) NOT NULL,
  "recentOpponentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);
CREATE INDEX IF NOT EXISTS "DeliveryLadderEntry_state_due_user_idx" ON "DeliveryLadderEntry"("state","dueAt","userId");
CREATE INDEX IF NOT EXISTS "DeliveryLadderEntry_state_rating_user_idx" ON "DeliveryLadderEntry"("state","rating","userId");
CREATE INDEX IF NOT EXISTS "DeliveryLadderEntry_rank_user_idx" ON "DeliveryLadderEntry"("rankedScore" DESC,"userId");
CREATE INDEX IF NOT EXISTS "DeliveryEvaluation_kind_status_publishedAt_idx" ON "DeliveryEvaluation"("kind","status","publishedAt");
CREATE TABLE IF NOT EXISTS "DeliveryLadderClock" (
  "id" TEXT PRIMARY KEY, "nextRatedAt" TIMESTAMP(3) NOT NULL,
  "placementStreak" INTEGER NOT NULL DEFAULT 0, "ratedSequence" INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "DeliveryLadderEntry" ("userId","activeVersionId","activeName","state","dueAt","availableAt")
SELECT DISTINCT ON ("userId") "userId",id,name,'pending',"createdAt",now() AT TIME ZONE 'UTC'
FROM "DeliveryBotVersion" WHERE "validUntil" IS NULL
ORDER BY "userId","createdAt" DESC,id
ON CONFLICT ("userId") DO UPDATE SET
  "activeVersionId"=EXCLUDED."activeVersionId", "activeName"=EXCLUDED."activeName", state='pending',
  rating=CASE WHEN "DeliveryLadderEntry"."rankedVersionId" IS NULL THEN 1500 ELSE "DeliveryLadderEntry"."rankedRating" END,
  deviation=CASE WHEN "DeliveryLadderEntry"."rankedVersionId" IS NULL THEN 320 ELSE GREATEST(200,"DeliveryLadderEntry"."rankedDeviation") END,
  sets=0, "cleanGames"=0, "dueAt"=EXCLUDED."dueAt", "availableAt"=EXCLUDED."availableAt", "recentOpponentIds"=ARRAY[]::TEXT[]
WHERE "DeliveryLadderEntry"."activeVersionId" IS DISTINCT FROM EXCLUDED."activeVersionId";
UPDATE "DeliveryLadderEntry" e SET "activeVersionId"=NULL,state='withdrawn'
WHERE e."activeVersionId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "DeliveryBotVersion" b WHERE b."userId"=e."userId" AND b."validUntil" IS NULL
);
COMMIT;

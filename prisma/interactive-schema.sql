-- Additive and safe to run again. Existing submissions remain unchanged.
ALTER TABLE "SubmissionRuntimeTestResult" ADD COLUMN IF NOT EXISTS "interactionLog" TEXT;

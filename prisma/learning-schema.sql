-- Additive installation only: do not change or drop existing judge/platform tables.
CREATE TABLE IF NOT EXISTS "LearningCourse" (
  "id" TEXT NOT NULL PRIMARY KEY, "authorId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "slug" TEXT NOT NULL, "summary" TEXT NOT NULL,
  "visibility" "Visibility" NOT NULL DEFAULT 'private', "draft" JSONB NOT NULL,
  "editVersion" INTEGER NOT NULL DEFAULT 1, "publishedVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "LearningCourse_slug_key" ON "LearningCourse"("slug");
CREATE INDEX IF NOT EXISTS "LearningCourse_authorId_updatedAt_idx" ON "LearningCourse"("authorId", "updatedAt");
CREATE TABLE IF NOT EXISTS "LearningCourseVersion" (
  "id" TEXT NOT NULL PRIMARY KEY, "courseId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "summary" TEXT NOT NULL, "outline" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningCourseVersion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "LearningCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LearningCourseVersion_courseId_createdAt_idx" ON "LearningCourseVersion"("courseId", "createdAt");
CREATE TABLE IF NOT EXISTS "LearningItem" (
  "versionId" TEXT NOT NULL, "itemId" TEXT NOT NULL, "content" JSONB NOT NULL, "storageKey" TEXT,
  CONSTRAINT "LearningItem_pkey" PRIMARY KEY ("versionId", "itemId"),
  CONSTRAINT "LearningItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LearningCourseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "LearningProgress" (
  "userId" TEXT NOT NULL, "versionId" TEXT NOT NULL, "itemId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3), "score" INTEGER NOT NULL DEFAULT 0, "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3), "submissionId" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningProgress_pkey" PRIMARY KEY ("userId", "versionId", "itemId"),
  CONSTRAINT "LearningProgress_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LearningCourseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LearningProgress_userId_updatedAt_idx" ON "LearningProgress"("userId", "updatedAt");

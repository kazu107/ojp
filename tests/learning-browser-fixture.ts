// A disposable local fixture; never point this script at a production database.
import type { User } from "../lib/types";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/ojp_learning_test"
  )
    throw new Error("Use the disposable ojp_learning_test database only.");
  process.env.STORE_DB_SYNC = "0";
  process.env.LEARNING_STORAGE = "db";
  const { sampleLearningDraft, newLearningItem } = await import(
    "../lib/learning"
  );
  const { saveLearningDraft, publishLearningCourse } = await import(
    "../lib/learning-store"
  );
  const { prisma } = await import("../lib/db/prisma");
  const author: User = {
    id: "fixture-author",
    role: "admin",
    status: "active",
    username: "fixture",
    displayName: "Fixture",
    bio: "",
    displayNameChangedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const draft = sampleLearningDraft();
  draft.slug = `local-browser-${Date.now()}`;
  draft.visibility = "public";
  const practice = newLearningItem("problem", "practice");
  practice.title = "練習：入力と出力";
  practice.problemId = "p1000";
  draft.chapters[0].items.push(practice);
  const saved = await saveLearningDraft(author, draft);
  const version = await publishLearningCourse(
    author,
    saved.id,
    saved.editVersion,
  );
  console.log(
    JSON.stringify({ courseId: saved.id, versionId: version.versionId }),
  );
  await prisma.$disconnect();
}
void main();

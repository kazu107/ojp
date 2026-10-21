import assert from "node:assert/strict";
import test from "node:test";
import { newLearningItem, sampleLearningDraft } from "../lib/learning";
import type { User } from "../lib/types";

test(
  "isolated PostgreSQL: publishing, permissions, progress, concurrency and version retention",
  { skip: !process.env.LEARNING_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.LEARNING_TEST_DATABASE_URL!);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname === "/ojp_learning_test",
      "Integration tests must use the disposable local learning database.",
    );
    process.env.DATABASE_URL = url.toString();
    process.env.STORE_DB_SYNC = "0";
    process.env.LEARNING_STORAGE = "db";
    const store = await import("../lib/learning-store");
    const { prisma } = await import("../lib/db/prisma");
    const user: User = {
      id: "learning-test-author",
      username: "test",
      displayName: "Test",
      bio: "",
      role: "problem_author",
      status: "active",
      displayNameChangedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const other = {
      ...user,
      id: "learning-test-student",
      role: "user" as const,
    };
    const draft = sampleLearningDraft();
    draft.slug = `test-${Date.now()}`;
    draft.visibility = "public";
    const practice = newLearningItem("problem", "practice");
    practice.problemId = "p1000";
    draft.chapters[0].items.push(practice);
    let courseId: string | undefined;
    try {
      await assert.rejects(
        store.saveLearningDraft(other, draft),
        /role is required/,
      );
      const saved = await store.saveLearningDraft(user, draft);
      courseId = saved.id;
      await assert.rejects(
        store.learningCourseForEditor(courseId, other),
        /not editable/,
      );
      await assert.rejects(
        store.learningVersionForViewer(courseId, null),
        /not found/,
      );
      const published = await store.publishLearningCourse(
        user,
        courseId,
        saved.editVersion,
      );
      assert.ok(
        (await store.listLearningCourses(null)).some(
          (course) => course.id === courseId,
        ),
      );
      const visible = await store.getLearningItem(
        courseId,
        other,
        "check",
        published.versionId,
      );
      assert.ok(!JSON.stringify(visible).includes("answerId"));
      await assert.rejects(
        store.recordLearningProgress(courseId, other, {
          versionId: published.versionId,
          itemId: "practice",
          action: "problem",
          submissionId: "s1000",
        }),
        /Only your accepted/,
      );
      const owner = { ...other, id: "u2" };
      await store.recordLearningProgress(courseId, owner, {
        versionId: published.versionId,
        itemId: "practice",
        action: "problem",
        submissionId: "s1000",
      });
      assert.ok(
        (
          await store.getLearningProgress(courseId, owner, published.versionId)
        ).some((entry) => entry.itemId === "practice" && entry.completed),
      );
      await assert.rejects(
        store.unpublishLearningCourse(
          user,
          courseId,
          undefined as unknown as number,
        ),
        /edit version/,
      );
      await assert.rejects(
        store.recordLearningProgress(courseId, other, {
          versionId: published.versionId,
          itemId: "check",
          action: "read",
        }),
        /quiz attempt/,
      );
      const failed = await store.recordLearningProgress(courseId, other, {
        versionId: published.versionId,
        itemId: "check",
        action: "quiz",
        answers: { q1: "b" },
      });
      assert.equal(failed.quiz?.passed, false);
      await assert.rejects(
        store.recordLearningProgress(courseId, other, {
          versionId: published.versionId,
          itemId: "check",
          action: "quiz",
          answers: { q1: "a" },
        }),
        /3 seconds/,
      );
      await prisma.learningProgress.update({
        where: {
          userId_versionId_itemId: {
            userId: other.id,
            versionId: published.versionId,
            itemId: "check",
          },
        },
        data: { lastAttemptAt: new Date(Date.now() - 4000) },
      });
      const attempts = await Promise.allSettled(
        ["a", "b"].map((answer) =>
          store.recordLearningProgress(courseId!, other, {
            versionId: published.versionId,
            itemId: "check",
            action: "quiz",
            answers: { q1: answer },
          }),
        ),
      );
      assert.equal(
        attempts.filter((attempt) => attempt.status === "fulfilled").length,
        1,
      );
      await store.recordLearningProgress(courseId, other, {
        versionId: published.versionId,
        itemId: "input",
        action: "read",
      });
      const writes = await Promise.allSettled([
        store.saveLearningDraft(user, draft, courseId, published.editVersion),
        store.saveLearningDraft(user, draft, courseId, published.editVersion),
      ]);
      assert.equal(
        writes.filter((write) => write.status === "fulfilled").length,
        1,
      );
      const next = await store.publishLearningCourse(
        user,
        courseId,
        published.editVersion + 1,
      );
      const courseView = (await store.listLearningCourses(other)).find(
        (course) => course.id === courseId,
      );
      assert.equal(courseView?.previousVersionId, published.versionId);
      assert.equal(
        (await store.getLearningProgress(courseId, other, next.versionId))
          .length,
        0,
      );
      assert.ok(
        (
          await store.getLearningProgress(courseId, other, published.versionId)
        ).some((entry) => entry.itemId === "input" && entry.completed),
      );
      await store.unpublishLearningCourse(user, courseId, next.editVersion);
      await assert.rejects(
        store.getLearningItem(courseId, other, "input", published.versionId),
        /not found/,
      );
      const retained = await store.getLearningItem(
        courseId,
        user,
        "input",
        published.versionId,
      );
      assert.ok(retained.item.markdown.includes("input()"));
    } finally {
      if (courseId)
        await prisma.learningCourse.delete({ where: { id: courseId } });
      await prisma.$disconnect();
    }
  },
);

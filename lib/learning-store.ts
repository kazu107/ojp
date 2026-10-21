import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db/prisma";
import {
  canCreateProblemByRole,
  getProblemById,
  getProblemForViewer,
  getSubmissionWithAccess,
} from "./store";
import type { User } from "./types";
import {
  gradeLearningQuiz,
  LearningError,
  learningOutline,
  publicLearningItem,
  validateLearningDraft,
} from "./learning";
import type {
  LearningDraft,
  LearningItemDraft,
  LearningOutline,
  LearningProgressView,
} from "./learning";
import {
  getLearningMarkdown,
  putLearningMarkdown,
  removeLearningMarkdown,
} from "./learning-storage";

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export function canAuthorLearning(user: User | null) {
  return (
    !!user && user.status === "active" && canCreateProblemByRole(user.role)
  );
}
export function canEditLearning(
  course: { authorId: string },
  user: User | null,
) {
  return (
    !!user &&
    user.status === "active" &&
    (course.authorId === user.id || user.role === "admin")
  );
}
export function canReadLearning(
  course: {
    authorId: string;
    visibility: string;
    publishedVersionId: string | null;
  },
  user: User | null,
  direct = true,
) {
  return (
    canEditLearning(course, user) ||
    (!!course.publishedVersionId &&
      (course.visibility === "public" ||
        (direct && course.visibility === "unlisted")))
  );
}
function active(user: User) {
  if (user.status !== "active")
    throw new LearningError("Your account is not active.", 403);
}
function checkEditVersion(value: unknown) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) >= 2147483647
  )
    throw new LearningError("A valid edit version is required.");
}

export async function learningCourseForEditor(courseId: string, user: User) {
  const course = await prisma.learningCourse.findUnique({
    where: { id: courseId },
  });
  if (!course || !canEditLearning(course, user))
    throw new LearningError("Course not found or not editable.", 404);
  return {
    id: course.id,
    editVersion: course.editVersion,
    publishedVersionId: course.publishedVersionId,
    draft: course.draft as unknown as LearningDraft,
  };
}

export async function listLearningCourses(user: User | null) {
  const courses = await prisma.learningCourse.findMany({
    where:
      user?.role === "admin" && user.status === "active"
        ? {}
        : {
            OR: [
              { visibility: "public", publishedVersionId: { not: null } },
              ...(user ? [{ authorId: user.id }] : []),
            ],
          },
    select: {
      id: true,
      authorId: true,
      title: true,
      slug: true,
      summary: true,
      visibility: true,
      publishedVersionId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  // Published titles and summaries remain stable while their draft is being edited.
  const versions = await prisma.learningCourseVersion.findMany({
    where: {
      id: {
        in: courses.flatMap((course) =>
          course.publishedVersionId ? [course.publishedVersionId] : [],
        ),
      },
    },
    select: {
      id: true,
      courseId: true,
      title: true,
      summary: true,
      outline: true,
    },
  });
  const progress = user
    ? await prisma.learningProgress.findMany({
        where: {
          userId: user.id,
          version: { courseId: { in: courses.map((course) => course.id) } },
          completedAt: { not: null },
        },
        select: { versionId: true, itemId: true },
        orderBy: { updatedAt: "desc" },
      })
    : [];
  const previousIds = [
    ...new Set(progress.map((entry) => entry.versionId)),
  ].filter((id) => !versions.some((version) => version.id === id));
  if (previousIds.length)
    versions.push(
      ...(await prisma.learningCourseVersion.findMany({
        where: { id: { in: previousIds } },
        select: {
          id: true,
          courseId: true,
          title: true,
          summary: true,
          outline: true,
        },
      })),
    );
  return courses
    .filter((course) => canReadLearning(course, user, false))
    .map((course) => {
      const version = versions.find(
        (entry) => entry.id === course.publishedVersionId,
      );
      const required = version
        ? (version.outline as unknown as LearningOutline).chapters
            .flatMap((chapter) => chapter.items)
            .filter((item) => item.required)
        : [];
      const previousVersion = progress
        .map((entry) =>
          versions.find(
            (version) =>
              version.id === entry.versionId &&
              version.courseId === course.id &&
              version.id !== course.publishedVersionId,
          ),
        )
        .find((entry) => !!entry);
      const previousRequired = previousVersion
        ? (previousVersion.outline as unknown as LearningOutline).chapters
            .flatMap((chapter) => chapter.items)
            .filter((item) => item.required)
        : [];
      return {
        ...course,
        updatedAt: course.updatedAt.toISOString(),
        title: version?.title ?? course.title,
        summary: version?.summary ?? course.summary,
        canEdit: canEditLearning(course, user),
        total: required.length,
        previousVersionId: previousVersion?.id ?? null,
        previousCompleted: previousRequired.filter((item) =>
          progress.some(
            (entry) =>
              entry.versionId === previousVersion?.id &&
              entry.itemId === item.id,
          ),
        ).length,
        previousTotal: previousRequired.length,
        completed: required.filter((item) =>
          progress.some(
            (entry) =>
              entry.versionId === version?.id && entry.itemId === item.id,
          ),
        ).length,
      };
    });
}

export async function saveLearningDraft(
  user: User,
  raw: unknown,
  courseId?: string,
  expectedVersion?: number,
) {
  active(user);
  const draft = validateLearningDraft(raw);
  if (!courseId) {
    if (!canAuthorLearning(user))
      throw new LearningError(
        "A problem_author or admin role is required.",
        403,
      );
    return prisma.learningCourse.create({
      data: {
        id: randomUUID(),
        authorId: user.id,
        title: draft.title,
        slug: draft.slug,
        summary: draft.summary,
        draft: json(draft),
      },
      select: { id: true, editVersion: true },
    });
  }
  await learningCourseForEditor(courseId, user);
  checkEditVersion(expectedVersion);
  const result = await prisma.learningCourse.updateMany({
    where: { id: courseId, editVersion: expectedVersion },
    data: {
      title: draft.title,
      slug: draft.slug,
      summary: draft.summary,
      draft: json(draft),
      editVersion: { increment: 1 },
    },
  });
  if (!result.count)
    throw new LearningError(
      "Another edit was saved. Reload before saving again.",
      409,
    );
  return { id: courseId, editVersion: expectedVersion! + 1 };
}

export async function publishLearningCourse(
  user: User,
  courseId: string,
  expectedVersion: number,
) {
  checkEditVersion(expectedVersion);
  const editor = await learningCourseForEditor(courseId, user);
  if (editor.editVersion !== expectedVersion)
    throw new LearningError("Save the current draft before publishing.", 409);
  const draft = validateLearningDraft(editor.draft);
  const items = draft.chapters.flatMap((chapter) => chapter.items);
  for (const item of items) {
    if (item.kind === "problem") {
      const problem = getProblemById(item.problemId);
      // Do not grant access to private problems implicitly through a course.
      if (!problem || problem.visibility !== "public")
        throw new LearningError(
          "Practice items must reference an existing public problem.",
        );
    }
  }
  const versionId = randomUUID();
  const stored: {
    versionId: string;
    itemId: string;
    storageKey: string | null;
    content: Prisma.InputJsonValue;
  }[] = [];
  const keys: string[] = [];
  try {
    for (let offset = 0; offset < items.length; offset += 4) {
      const batch = await Promise.allSettled(
        items.slice(offset, offset + 4).map(async (item) => {
          const storageKey =
            item.kind === "lesson"
              ? await putLearningMarkdown(versionId, item.id, item.markdown)
              : null;
          if (storageKey) keys.push(storageKey);
          stored.push({
            versionId,
            itemId: item.id,
            storageKey,
            content: json({
              ...item,
              markdown: storageKey ? "" : item.markdown,
            }),
          });
        }),
      );
      const failed = batch.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    await prisma.$transaction(async (tx) => {
      const locked = await tx.learningCourse.updateMany({
        where: { id: courseId, editVersion: expectedVersion },
        data: {
          publishedVersionId: versionId,
          visibility: draft.visibility,
          editVersion: { increment: 1 },
        },
      });
      if (!locked.count)
        throw new LearningError(
          "Another edit was saved while publishing. Reload and try again.",
          409,
        );
      await tx.learningCourseVersion.create({
        data: {
          id: versionId,
          courseId,
          title: draft.title,
          summary: draft.summary,
          outline: json(learningOutline(draft)),
        },
      });
      await tx.learningItem.createMany({ data: stored });
    });
    return { versionId, editVersion: expectedVersion + 1 };
  } catch (error) {
    await removeLearningMarkdown(keys);
    throw error;
  }
}

export async function unpublishLearningCourse(
  user: User,
  courseId: string,
  expectedVersion: number,
) {
  checkEditVersion(expectedVersion);
  await learningCourseForEditor(courseId, user);
  const updated = await prisma.learningCourse.updateMany({
    where: { id: courseId, editVersion: expectedVersion },
    data: {
      publishedVersionId: null,
      visibility: "private",
      editVersion: { increment: 1 },
    },
  });
  if (!updated.count)
    throw new LearningError("Another edit was saved. Reload first.", 409);
  return { editVersion: expectedVersion + 1 };
}

export async function learningVersionForViewer(
  courseId: string,
  user: User | null,
  versionId?: string,
) {
  const course = await prisma.learningCourse.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      authorId: true,
      visibility: true,
      publishedVersionId: true,
    },
  });
  if (!course || !canReadLearning(course, user))
    throw new LearningError("Course not found.", 404);
  const selectedId = versionId ?? course.publishedVersionId;
  if (!selectedId)
    throw new LearningError("This course has not been published.", 404);
  const version = await prisma.learningCourseVersion.findFirst({
    where: { id: selectedId, courseId },
  });
  if (!version) throw new LearningError("Course version not found.", 404);
  return {
    course,
    version,
    outline: version.outline as unknown as LearningOutline,
  };
}

async function itemForViewer(
  courseId: string,
  user: User | null,
  itemId: string,
  versionId?: string,
) {
  const context = await learningVersionForViewer(courseId, user, versionId);
  const row = await prisma.learningItem.findUnique({
    where: { versionId_itemId: { versionId: context.version.id, itemId } },
  });
  if (!row) throw new LearningError("Learning item not found.", 404);
  return { ...context, row, item: row.content as unknown as LearningItemDraft };
}

export async function getLearningItem(
  courseId: string,
  user: User | null,
  itemId: string,
  versionId?: string,
) {
  const { row, item } = await itemForViewer(courseId, user, itemId, versionId);
  const visible = publicLearningItem(item);
  if (row.storageKey)
    visible.markdown = await getLearningMarkdown(row.storageKey);
  if (item.kind !== "problem") return { item: visible, problem: null };
  const problem = getProblemForViewer(item.problemId, user?.id ?? "guest");
  if (!problem)
    throw new LearningError("The linked problem is no longer available.", 404);
  return {
    item: visible,
    problem: {
      id: problem.id,
      title: problem.title,
      statementMarkdown: problem.statementMarkdown,
      inputDescription: problem.inputDescription,
      outputDescription: problem.outputDescription,
      constraintsMarkdown: problem.constraintsMarkdown,
      sampleCases: problem.sampleCases,
      samplePairCount:
        problem.latestPackageSummary?.samplePairs ?? problem.sampleCases.length,
    },
  };
}

export async function getLearningProgress(
  courseId: string,
  user: User | null,
  versionId?: string,
): Promise<LearningProgressView[]> {
  const { version } = await learningVersionForViewer(courseId, user, versionId);
  if (!user) return [];
  const rows = await prisma.learningProgress.findMany({
    where: { userId: user.id, versionId: version.id },
    select: { itemId: true, completedAt: true, score: true, attempts: true },
  });
  return rows.map((row) => ({
    itemId: row.itemId,
    completed: !!row.completedAt,
    score: row.score,
    attempts: row.attempts,
  }));
}

export async function recordLearningProgress(
  courseId: string,
  user: User,
  body: Record<string, unknown>,
) {
  active(user);
  if (typeof body.itemId !== "string" || typeof body.versionId !== "string")
    throw new LearningError("Item and version are required.");
  const { version, item } = await itemForViewer(
    courseId,
    user,
    body.itemId,
    body.versionId,
  );
  const where = {
    userId_versionId_itemId: {
      userId: user.id,
      versionId: version.id,
      itemId: item.id,
    },
  };
  let score = 100;
  let completed = true;
  let submissionId: string | undefined;
  let quiz: ReturnType<typeof gradeLearningQuiz> | undefined;
  if (item.kind === "lesson") {
    if (body.action !== "read")
      throw new LearningError("Lessons are completed with the read action.");
  } else if (item.kind === "quiz") {
    if (body.action !== "quiz")
      throw new LearningError("This item requires a quiz attempt.");
    quiz = gradeLearningQuiz(item, body.answers);
    score = quiz.score;
    completed = quiz.passed;
  } else {
    if (body.action !== "problem" || typeof body.submissionId !== "string")
      throw new LearningError("Provide a judged submission ID.");
    const result = await getSubmissionWithAccess(body.submissionId, user.id);
    if (
      !result ||
      result.submission.userId !== user.id ||
      result.submission.problemId !== item.problemId ||
      result.submission.status !== "accepted"
    )
      throw new LearningError(
        "Only your accepted submission for this problem can complete this item.",
      );
    if (!getProblemForViewer(item.problemId, user.id))
      throw new LearningError("The linked problem is not available.", 404);
    if (
      !item.allowPastAccepted &&
      new Date(result.submission.submittedAt) < version.createdAt
    )
      throw new LearningError(
        "Submit an accepted solution after this course version was published.",
      );
    submissionId = result.submission.id;
  }
  await prisma.$transaction(async (tx) => {
    // The composite-key upsert locks the per-user/item row; concurrent quizzes cannot bypass the cooldown.
    await tx.learningProgress.upsert({
      where,
      create: { ...where.userId_versionId_itemId },
      update: {},
    });
    if (quiz) {
      const permitted = await tx.learningProgress.updateMany({
        where: {
          ...where.userId_versionId_itemId,
          OR: [
            { lastAttemptAt: null },
            { lastAttemptAt: { lt: new Date(Date.now() - 3000) } },
          ],
        },
        data: { lastAttemptAt: new Date(), attempts: { increment: 1 } },
      });
      if (!permitted.count)
        throw new LearningError(
          "Wait 3 seconds before retrying the quiz.",
          429,
        );
    }
    await tx.learningProgress.updateMany({
      where: { ...where.userId_versionId_itemId, score: { lt: score } },
      data: { score },
    });
    if (completed)
      await tx.learningProgress.updateMany({
        where: { ...where.userId_versionId_itemId, completedAt: null },
        data: { completedAt: new Date() },
      });
    if (submissionId)
      await tx.learningProgress.update({ where, data: { submissionId } });
  });
  return {
    progress: await getLearningProgress(courseId, user, version.id),
    quiz,
  };
}

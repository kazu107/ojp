import { PrismaClient } from "@prisma/client";
import { dumpStoreSnapshot } from "../lib/store";

const prisma = new PrismaClient();

async function clearAll() {
  await prisma.appState.deleteMany();
  await prisma.rejudgeRequest.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.report.deleteMany();
  await prisma.submissionTestResult.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.contestParticipant.deleteMany();
  await prisma.contestProblem.deleteMany();
  await prisma.contest.deleteMany();
  await prisma.problem.deleteMany();
  await prisma.user.deleteMany();
}

async function seedFromSnapshot() {
  const snapshot = dumpStoreSnapshot();

  if (snapshot.users.length > 0) {
    await prisma.user.createMany({
      data: snapshot.users.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        role: user.role,
        status: user.status,
        displayNameChangedAt: user.displayNameChangedAt
          ? new Date(user.displayNameChangedAt)
          : null,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt),
      })),
    });
  }

  if (snapshot.problems.length > 0) {
    await prisma.problem.createMany({
      data: snapshot.problems.map((problem) => ({
        id: problem.id,
        authorId: problem.authorId,
        title: problem.title,
        slug: problem.slug,
        statementMarkdown: problem.statementMarkdown,
        inputDescription: problem.inputDescription,
        outputDescription: problem.outputDescription,
        constraintsMarkdown: problem.constraintsMarkdown,
        explanationMarkdown: problem.explanationMarkdown,
        visibility: problem.visibility,
        timeLimitMs: problem.timeLimitMs,
        memoryLimitMb: problem.memoryLimitMb,
        supportedLanguages: problem.supportedLanguages,
        scoringType: problem.scoringType,
        createdAt: new Date(problem.createdAt),
        updatedAt: new Date(problem.updatedAt),
      })),
    });
  }

  if (snapshot.contests.length > 0) {
    await prisma.contest.createMany({
      data: snapshot.contests.map((contest) => ({
        id: contest.id,
        organizerId: contest.organizerId,
        title: contest.title,
        slug: contest.slug,
        descriptionMarkdown: contest.descriptionMarkdown,
        visibility: contest.visibility,
        startAt: new Date(contest.startAt),
        endAt: new Date(contest.endAt),
        penaltyMinutes: contest.penaltyMinutes,
        scoreboardVisibility: contest.scoreboardVisibility,
        createdAt: new Date(contest.createdAt),
        updatedAt: new Date(contest.updatedAt),
      })),
    });

    await prisma.contestProblem.createMany({
      data: snapshot.contests.flatMap((contest) =>
        contest.problems.map((problem) => ({
          contestId: contest.id,
          problemId: problem.problemId,
          label: problem.label,
          score: problem.score,
          orderIndex: problem.orderIndex,
        })),
      ),
    });

    await prisma.contestParticipant.createMany({
      data: snapshot.contests.flatMap((contest) =>
        contest.participantUserIds.map((userId) => ({
          contestId: contest.id,
          userId,
          registeredAt: new Date(contest.createdAt),
        })),
      ),
    });
  }

  if (snapshot.submissions.length > 0) {
    await prisma.submission.createMany({
      data: snapshot.submissions.map((submission) => ({
        id: submission.id,
        userId: submission.userId,
        problemId: submission.problemId,
        contestId: submission.contestId,
        language: submission.language,
        sourceCode: submission.sourceCode,
        status: submission.status,
        score: submission.score,
        totalTimeMs: submission.totalTimeMs,
        peakMemoryKb: submission.peakMemoryKb,
        submittedAt: new Date(submission.submittedAt),
        judgedAt: submission.judgedAt ? new Date(submission.judgedAt) : null,
      })),
    });

    await prisma.submissionTestResult.createMany({
      data: snapshot.submissions.flatMap((submission) =>
        submission.testResults.map((result) => ({
          id: result.id,
          submissionId: submission.id,
          groupName: result.groupName,
          testCaseName: result.testCaseName,
          verdict: result.verdict,
          timeMs: result.timeMs,
          memoryKb: result.memoryKb,
          message: result.message,
        })),
      ),
    });
  }

  if (snapshot.reports.length > 0) {
    await prisma.report.createMany({
      data: snapshot.reports.map((report) => ({
        id: report.id,
        reporterId: report.reporterId,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        detail: report.detail,
        status: report.status,
        createdAt: new Date(report.createdAt),
        updatedAt: new Date(report.updatedAt),
      })),
    });
  }

  if (snapshot.auditLogs.length > 0) {
    await prisma.auditLog.createMany({
      data: snapshot.auditLogs.map((log) => ({
        id: log.id,
        actorId: log.actorId,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        reason: log.reason,
        metadata: log.metadata,
        createdAt: new Date(log.createdAt),
      })),
    });
  }

  if (snapshot.rejudgeRequests.length > 0) {
    await prisma.rejudgeRequest.createMany({
      data: snapshot.rejudgeRequests.map((request) => ({
        id: request.id,
        requestedBy: request.requestedBy,
        submissionId: request.submissionId,
        problemId: request.problemId,
        reason: request.reason,
        detail: request.detail,
        createdAt: new Date(request.createdAt),
      })),
    });
  }
}

async function main() {
  await clearAll();
  await seedFromSnapshot();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

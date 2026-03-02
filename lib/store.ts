import {
  Announcement,
  AuditAction,
  AuditLog,
  Contest,
  ContestProblem,
  ContestStatus,
  CreateAnnouncementInput,
  CreateContestInput,
  CreateProblemInput,
  CreateReportInput,
  CreateSubmissionInput,
  Language,
  Problem,
  RejudgeRequest,
  Report,
  ReportStatus,
  RequestRejudgeInput,
  ScoreboardRow,
  Submission,
  SubmissionStatus,
  UpdateContestInput,
  UpdateProblemInput,
  User,
  UserRole,
  Visibility,
} from "@/lib/types";
import type { ProblemPackageExtracted } from "@/lib/problem-package";
import { executePackageJudge } from "@/lib/judge-runtime";
import { getJudgeEnvironmentVersion } from "@/lib/judge-config";
import {
  isAcceptedSubmissionStatus,
  isFinalSubmissionStatus,
  isWaitingSubmissionStatus,
  normalizeSubmissionStatus,
  pickHighestPriorityVerdict,
} from "@/lib/submission-status";
import { auth } from "@/auth";
const BASE_LANGUAGES: Language[] = ["cpp", "python", "java", "javascript"];

const SUBMISSION_COOLDOWN_MS = 10_000;
const SUBMISSION_LIMIT_WINDOW_MS = 60_000;
const SUBMISSION_LIMIT_PER_WINDOW = 20;

const REJUDGE_COOLDOWN_MS = 60_000;
const REJUDGE_LIMIT_WINDOW_MS = 60_000;
const REJUDGE_LIMIT_PER_WINDOW = 3;

const DISPLAY_NAME_CHANGE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
type JudgeJobReason = "normal" | "rejudge";

interface RateLimits {
  submissionByUserWindow: Record<string, number[]>;
  submissionCooldownByProblem: Record<string, number>;
  rejudgeByUserWindow: Record<string, number[]>;
  rejudgeCooldownByProblem: Record<string, number>;
}

interface Store {
  users: User[];
  problems: Problem[];
  problemPackages: Record<string, ProblemPackageExtracted>;
  contests: Contest[];
  submissions: Submission[];
  announcements: Announcement[];
  reports: Report[];
  auditLogs: AuditLog[];
  rejudgeRequests: RejudgeRequest[];
  githubIndex: Record<string, string>;
  judgeQueue: Array<{
    id: string;
    submissionId: string;
    queuedAt: string;
    reason: JudgeJobReason;
    requestedAt: string;
  }>;
  judgeInFlightSubmissionIds: string[];
  judgeWorkerRunning: boolean;
  counters: {
    user: number;
    problem: number;
    contest: number;
    submission: number;
    testResult: number;
    announcement: number;
    report: number;
    audit: number;
    rejudge: number;
    judgeJob: number;
  };
  rateLimits: RateLimits;
}

const globalStore = globalThis as unknown as {
  __ojpStore?: Store;
};

export class HttpError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function nowMs(): number {
  return Date.now();
}

function nowIso(): string {
  return new Date().toISOString();
}

function toSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function computeRetryAfter(remainingMs: number): number {
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function trimWindow(values: number[], windowMs: number, now: number): number[] {
  return values.filter((timestamp) => now - timestamp < windowMs);
}

function createInitialStore(): Store {
  const createdAt = "2026-02-20T09:00:00.000Z";
  const judgeEnvironmentVersion = getJudgeEnvironmentVersion();
  const users: User[] = [
    {
      id: "u1",
      username: "kazuu",
      displayName: "Kazuu",
      bio: "OJP initial admin",
      role: "admin",
      status: "active",
      displayNameChangedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "u2",
      username: "alice",
      displayName: "Alice",
      bio: "Competitive programmer",
      role: "user",
      status: "active",
      displayNameChangedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "u3",
      username: "bob",
      displayName: "Bob",
      bio: "Python user",
      role: "user",
      status: "active",
      displayNameChangedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const problems: Problem[] = [
    {
      id: "p1000",
      authorId: "u1",
      title: "A - Welcome to OJP",
      slug: "a-welcome-to-ojp",
      statementMarkdown: "整数 **N** が与えられます。`N` をそのまま出力してください。",
      inputDescription: "1行に整数 N (0 <= N <= 10^9)",
      outputDescription: "N を1行で出力してください。",
      constraintsMarkdown: "- 0 <= N <= 10^9",
      explanationMarkdown: "入力値を受け取り、そのまま標準出力に出せばACになります。",
      explanationVisibility: "always",
      visibility: "public",
      timeLimitMs: 2000,
      memoryLimitMb: 512,
      supportedLanguages: BASE_LANGUAGES,
      scoringType: "sum",
      testCaseVisibility: "case_index_only",
      latestPackageSummary: null,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "p1001",
      authorId: "u1",
      title: "B - Sum of Three",
      slug: "b-sum-of-three",
      statementMarkdown:
        "整数 `A B C` が与えられます。`A+B+C` を計算して出力してください。",
      inputDescription: "1行に整数 A, B, C",
      outputDescription: "A+B+C を1行で出力",
      constraintsMarkdown: "-10^9 <= A,B,C <= 10^9",
      explanationMarkdown:
        "64bit整数型での加算を推奨します。Pythonはそのままで問題ありません。",
      explanationVisibility: "always",
      visibility: "public",
      timeLimitMs: 2000,
      memoryLimitMb: 512,
      supportedLanguages: BASE_LANGUAGES,
      scoringType: "sum",
      testCaseVisibility: "case_index_only",
      latestPackageSummary: null,
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const contests: Contest[] = [
    {
      id: "c1000",
      organizerId: "u1",
      title: "OJP Beginner Contest 001",
      slug: "ojp-beginner-contest-001",
      descriptionMarkdown: "OJPの最初のコンテストです。A/Bの2問で構成されています。",
      visibility: "public",
      startAt: "2026-02-24T12:00:00.000Z",
      endAt: "2026-02-24T14:00:00.000Z",
      penaltyMinutes: 5,
      scoreboardVisibility: "full",
      problems: [
        { label: "A", problemId: "p1000", score: 100, orderIndex: 0 },
        { label: "B", problemId: "p1001", score: 100, orderIndex: 1 },
      ],
      participantUserIds: ["u1", "u2", "u3"],
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const submissions: Submission[] = [
    {
      id: "s1000",
      userId: "u2",
      problemId: "p1000",
      contestId: "c1000",
      language: "python",
      sourceCode: "print(input())",
      status: "accepted",
      score: 100,
      totalTimeMs: 12,
      peakMemoryKb: 2200,
      submittedAt: "2026-02-24T12:05:00.000Z",
      judgeStartedAt: "2026-02-24T12:05:00.100Z",
      judgedAt: "2026-02-24T12:05:01.000Z",
      judgeEnvironmentVersion,
      testResults: [
        {
          id: "tr1000",
          groupName: "samples",
          testCaseName: "sample1",
          verdict: "accepted",
          timeMs: 5,
          memoryKb: 1100,
          message: "Accepted",
        },
        {
          id: "tr1001",
          groupName: "samples",
          testCaseName: "sample2",
          verdict: "accepted",
          timeMs: 7,
          memoryKb: 1100,
          message: "Accepted",
        },
      ],
    },
    {
      id: "s1001",
      userId: "u3",
      problemId: "p1000",
      contestId: "c1000",
      language: "cpp",
      sourceCode:
        "#include <bits/stdc++.h>\\nusing namespace std;\\nint main(){long long n;cin>>n;cout<<n;}",
      status: "wrong_answer",
      score: 0,
      totalTimeMs: 20,
      peakMemoryKb: 3100,
      submittedAt: "2026-02-24T12:04:00.000Z",
      judgeStartedAt: "2026-02-24T12:04:00.100Z",
      judgedAt: "2026-02-24T12:04:01.000Z",
      judgeEnvironmentVersion,
      testResults: [
        {
          id: "tr1002",
          groupName: "samples",
          testCaseName: "sample1",
          verdict: "wrong_answer",
          timeMs: 10,
          memoryKb: 1500,
          message: "Expected output differs.",
        },
      ],
    },
  ];

  const announcements: Announcement[] = [
    {
      id: "an1000",
      title: "OJP MVP Open",
      body: "OJP MVP prototype is now available. Please report issues from the report page.",
      isHidden: false,
      createdAt: "2026-02-20T09:05:00.000Z",
      updatedAt: "2026-02-20T09:05:00.000Z",
    },
    {
      id: "an1001",
      title: "Judge Queue Monitoring Added",
      body: "Admin page now shows judge queue diagnostics and manual repair action.",
      isHidden: false,
      createdAt: "2026-02-26T08:30:00.000Z",
      updatedAt: "2026-02-26T08:30:00.000Z",
    },
  ];

  const reports: Report[] = [
    {
      id: "r1000",
      reporterId: "u2",
      targetType: "problem",
      targetId: "p1001",
      reason: "statement ambiguous",
      detail: "Constraint and sample explanation are slightly inconsistent.",
      status: "open",
      createdAt: "2026-02-25T01:10:00.000Z",
      updatedAt: "2026-02-25T01:10:00.000Z",
    },
  ];

  const auditLogs: AuditLog[] = [
    {
      id: "a1000",
      actorId: "u1",
      action: "admin.problem.hide",
      targetType: "problem",
      targetId: "p9999",
      reason: "seed log example",
      metadata: { note: "This is a sample audit entry." },
      createdAt: "2026-02-20T09:10:00.000Z",
    },
  ];

  const problemPackages: Record<string, ProblemPackageExtracted> = {
    p1000: {
      validation: {
        fileName: "seed-p1000.zip",
        zipSizeBytes: 0,
        fileCount: 0,
        samplePairs: 2,
        testGroupCount: 1,
        totalTestPairs: 2,
        config: {
          timeLimitMs: 2000,
          memoryLimitMb: 512,
          scoringType: "sum_of_groups",
          checkerType: "exact",
          compareMode: "exact",
          languages: [...BASE_LANGUAGES],
          groups: [{ name: "group1", score: 100, tests: 2 }],
        },
        warnings: ["seed package (embedded)"],
      },
      scoringType: "sum_of_groups",
      compareMode: "exact",
      groups: [
        {
          name: "group1",
          score: 100,
          orderIndex: 0,
          tests: [
            {
              name: "01",
              input: "1\n",
              output: "1\n",
            },
            {
              name: "02",
              input: "999999999\n",
              output: "999999999\n",
            },
          ],
        },
      ],
    },
    p1001: {
      validation: {
        fileName: "seed-p1001.zip",
        zipSizeBytes: 0,
        fileCount: 0,
        samplePairs: 2,
        testGroupCount: 1,
        totalTestPairs: 2,
        config: {
          timeLimitMs: 2000,
          memoryLimitMb: 512,
          scoringType: "sum_of_groups",
          checkerType: "exact",
          compareMode: "exact",
          languages: [...BASE_LANGUAGES],
          groups: [{ name: "group1", score: 100, tests: 2 }],
        },
        warnings: ["seed package (embedded)"],
      },
      scoringType: "sum_of_groups",
      compareMode: "exact",
      groups: [
        {
          name: "group1",
          score: 100,
          orderIndex: 0,
          tests: [
            {
              name: "01",
              input: "1 2 3\n",
              output: "6\n",
            },
            {
              name: "02",
              input: "-5 6 7\n",
              output: "8\n",
            },
          ],
        },
      ],
    },
  };

  return {
    users,
    problems,
    problemPackages,
    contests,
    submissions,
    announcements,
    reports,
    auditLogs,
    rejudgeRequests: [],
    githubIndex: {},
    judgeQueue: [],
    judgeInFlightSubmissionIds: [],
    judgeWorkerRunning: false,
    counters: {
      user: 4,
      problem: 1002,
      contest: 1001,
      submission: 1002,
      testResult: 1003,
      announcement: 1002,
      report: 1001,
      audit: 1001,
      rejudge: 1000,
      judgeJob: 1000,
    },
    rateLimits: {
      submissionByUserWindow: {},
      submissionCooldownByProblem: {},
      rejudgeByUserWindow: {},
      rejudgeCooldownByProblem: {},
    },
  };
}

const store = globalStore.__ojpStore ?? createInitialStore();

if (!globalStore.__ojpStore) {
  globalStore.__ojpStore = store;
}

if (!Array.isArray(store.judgeQueue)) {
  store.judgeQueue = [];
}
for (const job of store.judgeQueue) {
  const normalizedJob = job as {
    id: string;
    submissionId: string;
    queuedAt: string;
    reason?: JudgeJobReason;
    requestedAt?: string;
  };
  if (!normalizedJob.reason) {
    normalizedJob.reason = "normal";
  }
  if (!normalizedJob.requestedAt) {
    normalizedJob.requestedAt = normalizedJob.queuedAt || nowIso();
  }
}
if (!Array.isArray(store.judgeInFlightSubmissionIds)) {
  store.judgeInFlightSubmissionIds = [];
}
if (typeof store.judgeWorkerRunning !== "boolean") {
  store.judgeWorkerRunning = false;
}
if (typeof store.counters.judgeJob !== "number") {
  store.counters.judgeJob = 1000;
}
if (!store.problemPackages || typeof store.problemPackages !== "object") {
  store.problemPackages = {};
}
if (!Array.isArray(store.announcements)) {
  store.announcements = [];
}
if (typeof store.counters.announcement !== "number") {
  store.counters.announcement = 1000;
}
for (const problem of store.problems) {
  if (!problem.explanationVisibility) {
    problem.explanationVisibility = "private";
  }
  if (!problem.testCaseVisibility) {
    problem.testCaseVisibility = "case_index_only";
  }
  const legacyProblem = problem as Problem & {
    latestPackageSummary?: Problem["latestPackageSummary"];
  };
  if (legacyProblem.latestPackageSummary === undefined) {
    legacyProblem.latestPackageSummary = null;
  }
}
for (const submission of store.submissions) {
  const normalizedStatus = normalizeSubmissionStatus(submission.status);
  submission.status = normalizedStatus ?? "internal_error";

  const legacySubmission = submission as Submission & {
    judgeStartedAt?: string | null;
    judgeEnvironmentVersion?: string | null;
  };
  if (legacySubmission.judgeStartedAt === undefined) {
    legacySubmission.judgeStartedAt = submission.judgedAt ? submission.submittedAt : null;
  }
  if (legacySubmission.judgeEnvironmentVersion === undefined) {
    legacySubmission.judgeEnvironmentVersion = submission.judgedAt
      ? getJudgeEnvironmentVersion()
      : null;
  }

  submission.testResults = submission.testResults.map((result) => {
    const normalizedVerdict = normalizeSubmissionStatus(result.verdict);
    return {
      ...result,
      verdict: normalizedVerdict ?? "internal_error",
    };
  });
}
repairJudgeQueueInternal();

function nextUserId(): string {
  const id = `u${store.counters.user}`;
  store.counters.user += 1;
  return id;
}

function nextProblemId(): string {
  const id = `p${store.counters.problem}`;
  store.counters.problem += 1;
  return id;
}

function nextContestId(): string {
  const id = `c${store.counters.contest}`;
  store.counters.contest += 1;
  return id;
}

function nextSubmissionId(): string {
  const id = `s${store.counters.submission}`;
  store.counters.submission += 1;
  return id;
}

function nextTestResultId(): string {
  const id = `tr${store.counters.testResult}`;
  store.counters.testResult += 1;
  return id;
}

function nextAnnouncementId(): string {
  const id = `an${store.counters.announcement}`;
  store.counters.announcement += 1;
  return id;
}

function nextReportId(): string {
  const id = `r${store.counters.report}`;
  store.counters.report += 1;
  return id;
}

function nextAuditId(): string {
  const id = `a${store.counters.audit}`;
  store.counters.audit += 1;
  return id;
}

function nextRejudgeId(): string {
  const id = `rq${store.counters.rejudge}`;
  store.counters.rejudge += 1;
  return id;
}

function nextJudgeJobId(): string {
  const id = `jq${store.counters.judgeJob}`;
  store.counters.judgeJob += 1;
  return id;
}

function appendAuditLog(params: {
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  reason: string;
  metadata?: Record<string, string>;
}): void {
  store.auditLogs.unshift({
    id: nextAuditId(),
    actorId: params.actorId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    reason: params.reason,
    metadata: params.metadata ?? {},
    createdAt: nowIso(),
  });
}

function canViewVisibility(
  visibility: Visibility,
  ownerId: string,
  viewerId: string,
  isAdmin: boolean,
  isDetailView: boolean,
): boolean {
  if (isAdmin || ownerId === viewerId) {
    return true;
  }
  if (visibility === "public") {
    return true;
  }
  if (visibility === "unlisted" && isDetailView) {
    return true;
  }
  return false;
}

function uniqueSlugOrThrow(
  type: "problem" | "contest",
  slug: string,
  currentId?: string,
): void {
  const target = toSlug(slug);
  if (!target) {
    throw new HttpError("slug must not be empty", 400);
  }

  const duplicated =
    type === "problem"
      ? store.problems.some((problem) => problem.slug === target && problem.id !== currentId)
      : store.contests.some((contest) => contest.slug === target && contest.id !== currentId);

  if (duplicated) {
    throw new HttpError(`${type} slug already exists`, 409);
  }
}

function markSubmissionAsInternalError(submission: Submission, message: string): void {
  submission.status = "internal_error";
  submission.score = 0;
  submission.totalTimeMs = 0;
  submission.peakMemoryKb = 0;
  submission.judgedAt = nowIso();
  submission.testResults = [
    {
      id: nextTestResultId(),
      groupName: "system",
      testCaseName: "-",
      verdict: "internal_error",
      timeMs: 0,
      memoryKb: 0,
      message,
    },
  ];
}

function findSubmissionByIdInternal(submissionId: string): Submission | undefined {
  return store.submissions.find((submission) => submission.id === submissionId);
}

function hasInFlightJudgeForSubmission(submissionId: string): boolean {
  return store.judgeInFlightSubmissionIds.includes(submissionId);
}

function hasQueuedJudgeJobForSubmission(submissionId: string): boolean {
  return (
    store.judgeQueue.some((job) => job.submissionId === submissionId) ||
    hasInFlightJudgeForSubmission(submissionId)
  );
}

function collectWaitingSubmissionIds(): string[] {
  return store.submissions
    .filter((submission) => isWaitingSubmissionStatus(submission.status))
    .map((submission) => submission.id);
}

function getJudgeQueueStatsInternal(): {
  queuedJobs: number;
  waitingSubmissions: number;
  running: boolean;
} {
  return {
    queuedJobs: store.judgeQueue.length,
    waitingSubmissions: collectWaitingSubmissionIds().length,
    running: store.judgeWorkerRunning,
  };
}

function getJudgeQueueDiagnosticsInternal(limit = 50): {
  stats: {
    queuedJobs: number;
    waitingSubmissions: number;
    running: boolean;
  };
  jobs: Array<{
    id: string;
    submissionId: string;
    queuedAt: string;
    reason: JudgeJobReason;
    requestedAt: string;
  }>;
  orphanWaitingSubmissionIds: string[];
} {
  const waitingSubmissionIds = collectWaitingSubmissionIds();
  const queuedSubmissionIds = new Set<string>([
    ...store.judgeQueue.map((job) => job.submissionId),
    ...store.judgeInFlightSubmissionIds,
  ]);
  const orphanWaitingSubmissionIds = waitingSubmissionIds.filter(
    (submissionId) => !queuedSubmissionIds.has(submissionId),
  );

  return {
    stats: getJudgeQueueStatsInternal(),
    jobs: [...store.judgeQueue].slice(0, limit),
    orphanWaitingSubmissionIds,
  };
}

function repairJudgeQueueInternal(): number {
  const waitingSubmissionIds = collectWaitingSubmissionIds();
  const queuedSubmissionIds = new Set<string>([
    ...store.judgeQueue.map((job) => job.submissionId),
    ...store.judgeInFlightSubmissionIds,
  ]);

  let requeued = 0;
  for (const submissionId of waitingSubmissionIds) {
    if (queuedSubmissionIds.has(submissionId)) {
      continue;
    }
    const waitingSubmission = findSubmissionByIdInternal(submissionId);
    if (waitingSubmission?.status === "pending") {
      waitingSubmission.status = "queued";
    }
    store.judgeQueue.push({
      id: nextJudgeJobId(),
      submissionId,
      queuedAt: nowIso(),
      reason: "normal",
      requestedAt: nowIso(),
    });
    requeued += 1;
  }

  if (store.judgeQueue.length > 0) {
    scheduleJudgeWorker();
  }

  return requeued;
}

async function runJudgeForSubmission(submissionId: string, reason: JudgeJobReason): Promise<void> {
  const submission = findSubmissionByIdInternal(submissionId);
  if (!submission) {
    return;
  }
  if (!isWaitingSubmissionStatus(submission.status)) {
    return;
  }
  submission.judgeStartedAt = submission.judgeStartedAt ?? nowIso();
  submission.judgeEnvironmentVersion = getJudgeEnvironmentVersion();

  const problem = getProblemById(submission.problemId);
  if (!problem) {
    markSubmissionAsInternalError(submission, "problem not found while judging");
    appendAuditLog({
      actorId: submission.userId,
      action: "submission.judge",
      targetType: "submission",
      targetId: submission.id,
      reason,
      metadata: {
        result: submission.status,
        score: String(submission.score),
      },
    });
    return;
  }

  const packageData = store.problemPackages[problem.id];
  if (!packageData || packageData.groups.length === 0) {
    markSubmissionAsInternalError(
      submission,
      "problem package is not configured. upload ZIP package before judging",
    );
    appendAuditLog({
      actorId: submission.userId,
      action: "submission.judge",
      targetType: "submission",
      targetId: submission.id,
      reason,
      metadata: {
        result: submission.status,
        score: String(submission.score),
      },
    });
    return;
  }

  try {
    submission.status = "compiling";

    const judged = await executePackageJudge({
      sourceCode: submission.sourceCode,
      language: submission.language,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      packageData,
      nextTestResultId,
      onPhaseChange: (phase) => {
        submission.status = phase;
      },
    });
    submission.status = judged.status;
    submission.score = judged.score;
    submission.totalTimeMs = judged.totalTimeMs;
    submission.peakMemoryKb = judged.peakMemoryKb;
    submission.judgedAt = nowIso();
    submission.testResults = judged.testResults;

    appendAuditLog({
      actorId: submission.userId,
      action: "submission.judge",
      targetType: "submission",
      targetId: submission.id,
      reason,
      metadata: {
        result: submission.status,
        score: String(submission.score),
      },
    });
  } catch (error) {
    markSubmissionAsInternalError(
      submission,
      error instanceof Error ? error.message : "judge internal error",
    );
    appendAuditLog({
      actorId: submission.userId,
      action: "submission.judge",
      targetType: "submission",
      targetId: submission.id,
      reason,
      metadata: {
        result: submission.status,
        score: String(submission.score),
      },
    });
  }
}

function scheduleJudgeWorker(): void {
  if (store.judgeWorkerRunning) {
    return;
  }

  store.judgeWorkerRunning = true;
  const tick = async () => {
    const nextJob = store.judgeQueue.shift();
    if (!nextJob) {
      store.judgeWorkerRunning = false;
      return;
    }

    if (!hasInFlightJudgeForSubmission(nextJob.submissionId)) {
      store.judgeInFlightSubmissionIds.push(nextJob.submissionId);
    }
    try {
      await runJudgeForSubmission(nextJob.submissionId, nextJob.reason);
    } finally {
      store.judgeInFlightSubmissionIds = store.judgeInFlightSubmissionIds.filter(
        (submissionId) => submissionId !== nextJob.submissionId,
      );
    }
    setTimeout(() => {
      void tick();
    }, 50);
  };

  setTimeout(() => {
    void tick();
  }, 100);
}

function enqueueJudgeJob(submissionId: string, reason: JudgeJobReason = "normal"): void {
  const submission = findSubmissionByIdInternal(submissionId);
  if (!submission || isFinalSubmissionStatus(submission.status)) {
    return;
  }
  if (submission.status === "pending") {
    submission.status = "queued";
  }
  if (hasQueuedJudgeJobForSubmission(submissionId)) {
    scheduleJudgeWorker();
    return;
  }

  const requestedAt = nowIso();
  store.judgeQueue.push({
    id: nextJudgeJobId(),
    submissionId,
    queuedAt: requestedAt,
    reason,
    requestedAt,
  });
  scheduleJudgeWorker();
}

function sortBySubmittedAtAsc<T extends { submittedAt: string }>(items: T[]): T[] {
  return [...items].sort(
    (left, right) =>
      new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime(),
  );
}

function assertAdmin(user: User): void {
  if (user.role !== "admin") {
    throw new HttpError("admin only", 403);
  }
}

function assertActiveUser(user: User): void {
  if (user.status !== "active") {
    throw new HttpError("user account is not active", 403);
  }
}

function assertProblemAuthorOrAdmin(user: User): void {
  if (user.role === "admin" || user.role === "problem_author") {
    return;
  }
  throw new HttpError("problem creation requires problem_author role", 403);
}

function assertContestOrganizerOrAdmin(user: User): void {
  if (user.role === "admin" || user.role === "contest_organizer") {
    return;
  }
  throw new HttpError("contest creation requires contest_organizer role", 403);
}

function isAdminBypass(user: User): boolean {
  return user.role === "admin";
}

function enforceSubmissionRateLimit(userId: string, problemId: string, bypass: boolean): void {
  if (bypass) {
    return;
  }

  const now = nowMs();
  const windowKey = userId;
  const problemKey = `${userId}:${problemId}`;

  const recent = trimWindow(
    store.rateLimits.submissionByUserWindow[windowKey] ?? [],
    SUBMISSION_LIMIT_WINDOW_MS,
    now,
  );

  if (recent.length >= SUBMISSION_LIMIT_PER_WINDOW) {
    const oldest = recent[0] ?? now;
    const retryAfter = computeRetryAfter(SUBMISSION_LIMIT_WINDOW_MS - (now - oldest));
    throw new HttpError(
      "submission rate limit exceeded (max 20 submissions per minute)",
      429,
      retryAfter,
    );
  }

  const last = store.rateLimits.submissionCooldownByProblem[problemKey];
  if (typeof last === "number" && now - last < SUBMISSION_COOLDOWN_MS) {
    const retryAfter = computeRetryAfter(SUBMISSION_COOLDOWN_MS - (now - last));
    throw new HttpError(
      "submission cooldown active for this problem (10 seconds)",
      429,
      retryAfter,
    );
  }

  recent.push(now);
  store.rateLimits.submissionByUserWindow[windowKey] = recent;
  store.rateLimits.submissionCooldownByProblem[problemKey] = now;
}

function enforceRejudgeRateLimit(userId: string, problemId: string, bypass: boolean): void {
  if (bypass) {
    return;
  }

  const now = nowMs();
  const windowKey = userId;
  const problemKey = `${userId}:${problemId}`;
  const recent = trimWindow(
    store.rateLimits.rejudgeByUserWindow[windowKey] ?? [],
    REJUDGE_LIMIT_WINDOW_MS,
    now,
  );

  if (recent.length >= REJUDGE_LIMIT_PER_WINDOW) {
    const oldest = recent[0] ?? now;
    const retryAfter = computeRetryAfter(REJUDGE_LIMIT_WINDOW_MS - (now - oldest));
    throw new HttpError(
      "rejudge rate limit exceeded (max 3 requests per minute)",
      429,
      retryAfter,
    );
  }

  const last = store.rateLimits.rejudgeCooldownByProblem[problemKey];
  if (typeof last === "number" && now - last < REJUDGE_COOLDOWN_MS) {
    const retryAfter = computeRetryAfter(REJUDGE_COOLDOWN_MS - (now - last));
    throw new HttpError(
      "rejudge cooldown active for this problem (60 seconds)",
      429,
      retryAfter,
    );
  }

  recent.push(now);
  store.rateLimits.rejudgeByUserWindow[windowKey] = recent;
  store.rateLimits.rejudgeCooldownByProblem[problemKey] = now;
}

function resolveProblemIfExists(problemId: string): Problem {
  const problem = getProblemById(problemId);
  if (!problem) {
    throw new HttpError("problem not found", 404);
  }
  return problem;
}

function resolveContestIfExists(contestId: string): Contest {
  const contest = getContestById(contestId);
  if (!contest) {
    throw new HttpError("contest not found", 404);
  }
  return contest;
}

function resolveSubmissionIfExists(submissionId: string): Submission {
  const submission = getSubmissionById(submissionId);
  if (!submission) {
    throw new HttpError("submission not found", 404);
  }
  return submission;
}

function findUserOrThrow(userId: string): User {
  const user = findUser(userId);
  if (!user) {
    throw new HttpError("user not found", 404);
  }
  return user;
}

interface SessionUserLike {
  githubId?: string;
  githubLogin?: string;
  githubBio?: string | null;
  name?: string | null;
}

function normalizeUsername(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "user";
}

function uniqueUsername(base: string, currentId?: string): string {
  let index = 1;
  let candidate = base;
  while (
    store.users.some(
      (entry) =>
        entry.id !== currentId &&
        entry.username.toLowerCase() === candidate.toLowerCase() &&
        entry.status !== "deleted",
    )
  ) {
    index += 1;
    candidate = `${base}${index}`;
  }
  return candidate;
}

function uniqueDisplayName(base: string, currentId?: string): string {
  let index = 1;
  let candidate = base || "user";
  while (
    store.users.some(
      (entry) =>
        entry.id !== currentId &&
        entry.displayName.toLowerCase() === candidate.toLowerCase() &&
        entry.status !== "deleted",
    )
  ) {
    index += 1;
    candidate = `${base}${index}`;
  }
  return candidate;
}

function findActiveUserByUsername(username: string): User | undefined {
  return store.users.find(
    (entry) =>
      entry.username.toLowerCase() === username.toLowerCase() && entry.status !== "deleted",
  );
}

function upsertUserFromGitHubSession(params: {
  githubId?: string;
  githubLogin: string;
  name?: string | null;
  bio?: string | null;
}): User {
  const normalizedLogin = normalizeUsername(params.githubLogin);
  const accountId = params.githubId?.trim() ?? "";
  const timestamp = nowIso();

  let user: User | undefined;
  if (accountId) {
    const indexedUserId = store.githubIndex[accountId];
    if (indexedUserId) {
      user = findUser(indexedUserId);
      if (!user) {
        delete store.githubIndex[accountId];
      }
    }
  }

  if (!user) {
    user = findActiveUserByUsername(normalizedLogin);
  }

  if (!user) {
    const displayNameBase = params.name?.trim() || normalizedLogin;
    user = {
      id: nextUserId(),
      username: uniqueUsername(normalizedLogin),
      displayName: uniqueDisplayName(displayNameBase),
      bio: params.bio?.trim() ?? "",
      role: "user",
      status: "active",
      displayNameChangedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.users.push(user);
  }

  if (user.status === "deleted") {
    throw new HttpError("user account is deleted", 403);
  }

  const nextUsername = uniqueUsername(normalizedLogin, user.id);
  if (nextUsername !== user.username) {
    user.username = nextUsername;
  }

  if ((!user.bio || !user.bio.trim()) && params.bio && params.bio.trim()) {
    user.bio = params.bio.trim();
  }

  user.updatedAt = timestamp;
  if (accountId) {
    store.githubIndex[accountId] = user.id;
  }
  return user;
}

function getSessionUserLike(session: unknown): SessionUserLike | null {
  if (!session || typeof session !== "object") {
    return null;
  }

  const maybeUser = (session as { user?: unknown }).user;
  if (!maybeUser || typeof maybeUser !== "object") {
    return null;
  }

  return maybeUser as SessionUserLike;
}

export async function getCurrentUser(): Promise<User> {
  const session = await auth();
  const sessionUser = getSessionUserLike(session);
  if (!sessionUser) {
    throw new HttpError("authentication required", 401);
  }

  if (!sessionUser.githubLogin) {
    throw new HttpError("github login is missing from session", 401);
  }

  return upsertUserFromGitHubSession({
    githubId: sessionUser.githubId,
    githubLogin: sessionUser.githubLogin,
    name: sessionUser.name,
    bio: sessionUser.githubBio,
  });
}

export async function getOptionalCurrentUser(): Promise<User | null> {
  try {
    return await getCurrentUser();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export function listUsers(): User[] {
  return [...store.users];
}

export function listAnnouncementsForViewer(viewerId: string): Announcement[] {
  const viewer = findUser(viewerId);
  const includeHidden = viewer?.role === "admin";
  return [...store.announcements]
    .filter((announcement) => includeHidden || !announcement.isHidden)
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
}

export async function listAnnouncementsForAdmin(): Promise<Announcement[]> {
  const user = await getCurrentUser();
  assertAdmin(user);
  return [...store.announcements].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export async function updateCurrentUserProfile(payload: {
  displayName?: string;
  bio?: string;
}): Promise<User> {
  const user = await getCurrentUser();
  assertActiveUser(user);
  const timestamp = nowIso();

  if (typeof payload.displayName === "string" && payload.displayName.trim()) {
    const candidate = payload.displayName.trim();
    if (candidate !== user.displayName) {
      if (user.displayNameChangedAt) {
        const elapsed = nowMs() - new Date(user.displayNameChangedAt).getTime();
        if (elapsed < DISPLAY_NAME_CHANGE_INTERVAL_MS) {
          const nextAllowed = new Date(
            new Date(user.displayNameChangedAt).getTime() + DISPLAY_NAME_CHANGE_INTERVAL_MS,
          );
          throw new HttpError(
            `displayName can be changed once every 30 days (next: ${nextAllowed.toISOString()})`,
            400,
          );
        }
      }

      const duplicated = store.users.some(
        (entry) =>
          entry.id !== user.id &&
          entry.displayName.toLowerCase() === candidate.toLowerCase() &&
          entry.status !== "deleted",
      );
      if (duplicated) {
        throw new HttpError("displayName must be unique", 409);
      }

      const before = user.displayName;
      user.displayName = candidate;
      user.displayNameChangedAt = timestamp;
      appendAuditLog({
        actorId: user.id,
        action: "profile.display_name.update",
        targetType: "user",
        targetId: user.id,
        reason: "display name updated",
        metadata: { from: before, to: candidate },
      });
    }
  }

  if (typeof payload.bio === "string") {
    user.bio = payload.bio.trim();
  }

  user.updatedAt = timestamp;
  return user;
}

export function getProblemById(problemId: string): Problem | undefined {
  return store.problems.find((problem) => problem.id === problemId);
}

function findContestsIncludingProblem(problemId: string): Contest[] {
  return store.contests.filter((contest) =>
    contest.problems.some((contestProblem) => contestProblem.problemId === problemId),
  );
}

function maskProblemExplanationByViewer(problem: Problem, viewerId: string): Problem {
  if (canViewProblemExplanation(problem, viewerId)) {
    return problem;
  }
  return {
    ...problem,
    explanationMarkdown: "",
  };
}

export function canViewProblemExplanation(problem: Problem, viewerId: string): boolean {
  const viewer = findUser(viewerId);
  if (viewer?.role === "admin" || problem.authorId === viewerId) {
    return true;
  }

  if (problem.explanationVisibility === "always") {
    return true;
  }
  if (problem.explanationVisibility === "private") {
    return false;
  }

  const relatedContests = findContestsIncludingProblem(problem.id);
  if (relatedContests.length === 0) {
    return false;
  }
  return relatedContests.every((contest) => getContestStatus(contest) === "ended");
}

export function listProblemsForListView(viewerId: string): Problem[] {
  const viewer = findUser(viewerId);
  const isAdmin = viewer?.role === "admin";

  return [...store.problems]
    .filter((problem) =>
      canViewVisibility(problem.visibility, problem.authorId, viewerId, !!isAdmin, false),
    )
    .map((problem) => maskProblemExplanationByViewer(problem, viewerId))
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
}

export function listPublicProblems(): Problem[] {
  return [...store.problems]
    .filter((problem) => problem.visibility === "public")
    .map((problem) => maskProblemExplanationByViewer(problem, "guest"))
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
}

export function getProblemForViewer(problemId: string, viewerId: string): Problem | undefined {
  const viewer = findUser(viewerId);
  const problem = getProblemById(problemId);
  if (!problem) {
    return undefined;
  }

  const allowed = canViewVisibility(
    problem.visibility,
    problem.authorId,
    viewerId,
    viewer?.role === "admin",
    true,
  );
  return allowed ? maskProblemExplanationByViewer(problem, viewerId) : undefined;
}

export async function createProblem(input: CreateProblemInput): Promise<Problem> {
  uniqueSlugOrThrow("problem", input.slug);
  const user = await getCurrentUser();
  assertActiveUser(user);
  assertProblemAuthorOrAdmin(user);

  const timestamp = nowIso();
  const problem: Problem = {
    id: nextProblemId(),
    authorId: user.id,
    title: input.title.trim(),
    slug: toSlug(input.slug),
    statementMarkdown: input.statementMarkdown.trim(),
    inputDescription: input.inputDescription.trim(),
    outputDescription: input.outputDescription.trim(),
    constraintsMarkdown: input.constraintsMarkdown.trim(),
    explanationMarkdown: input.explanationMarkdown.trim(),
    explanationVisibility: input.explanationVisibility,
    visibility: input.visibility,
    timeLimitMs: input.timeLimitMs,
    memoryLimitMb: input.memoryLimitMb,
    supportedLanguages: input.supportedLanguages,
    scoringType: "sum",
    testCaseVisibility: input.testCaseVisibility,
    latestPackageSummary: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  store.problems.unshift(problem);
  return problem;
}

export async function updateProblem(
  problemId: string,
  input: UpdateProblemInput,
): Promise<Problem> {
  const user = await getCurrentUser();
  const problem = resolveProblemIfExists(problemId);
  if (user.role !== "admin" && problem.authorId !== user.id) {
    throw new HttpError("you cannot edit this problem", 403);
  }

  if (typeof input.slug === "string") {
    uniqueSlugOrThrow("problem", input.slug, problemId);
    problem.slug = toSlug(input.slug);
  }
  if (typeof input.title === "string" && input.title.trim()) {
    problem.title = input.title.trim();
  }
  if (typeof input.statementMarkdown === "string") {
    problem.statementMarkdown = input.statementMarkdown.trim();
  }
  if (typeof input.inputDescription === "string") {
    problem.inputDescription = input.inputDescription.trim();
  }
  if (typeof input.outputDescription === "string") {
    problem.outputDescription = input.outputDescription.trim();
  }
  if (typeof input.constraintsMarkdown === "string") {
    problem.constraintsMarkdown = input.constraintsMarkdown.trim();
  }
  if (typeof input.explanationMarkdown === "string") {
    problem.explanationMarkdown = input.explanationMarkdown.trim();
  }
  if (input.explanationVisibility) {
    problem.explanationVisibility = input.explanationVisibility;
  }
  if (input.visibility) {
    problem.visibility = input.visibility;
  }
  if (typeof input.timeLimitMs === "number" && input.timeLimitMs > 0) {
    problem.timeLimitMs = input.timeLimitMs;
  }
  if (typeof input.memoryLimitMb === "number" && input.memoryLimitMb > 0) {
    problem.memoryLimitMb = input.memoryLimitMb;
  }
  if (Array.isArray(input.supportedLanguages) && input.supportedLanguages.length > 0) {
    problem.supportedLanguages = input.supportedLanguages;
  }
  if (input.testCaseVisibility) {
    problem.testCaseVisibility = input.testCaseVisibility;
  }

  problem.updatedAt = nowIso();
  return problem;
}

export async function applyProblemPackageValidation(
  problemId: string,
  packageData: ProblemPackageExtracted,
): Promise<Problem> {
  const actor = await getCurrentUser();
  const problem = resolveProblemIfExists(problemId);
  if (actor.role !== "admin" && problem.authorId !== actor.id) {
    throw new HttpError("you cannot upload package for this problem", 403);
  }

  problem.timeLimitMs = packageData.validation.config.timeLimitMs;
  problem.memoryLimitMb = packageData.validation.config.memoryLimitMb;
  problem.supportedLanguages = packageData.validation.config.languages;
  problem.scoringType =
    packageData.scoringType === "sum_of_groups" ? "sum_of_groups" : packageData.scoringType;
  problem.latestPackageSummary = {
    fileName: packageData.validation.fileName,
    zipSizeBytes: packageData.validation.zipSizeBytes,
    fileCount: packageData.validation.fileCount,
    samplePairs: packageData.validation.samplePairs,
    testGroupCount: packageData.validation.testGroupCount,
    totalTestPairs: packageData.validation.totalTestPairs,
    warnings: packageData.validation.warnings,
    validatedAt: nowIso(),
  };
  store.problemPackages[problem.id] = packageData;
  problem.updatedAt = nowIso();

  return problem;
}

export function listContestsForListView(viewerId: string): Contest[] {
  const viewer = findUser(viewerId);
  const isAdmin = viewer?.role === "admin";

  return [...store.contests]
    .filter((contest) =>
      canViewVisibility(contest.visibility, contest.organizerId, viewerId, !!isAdmin, false),
    )
    .sort((left, right) => new Date(right.startAt).getTime() - new Date(left.startAt).getTime());
}

export function getContestById(contestId: string): Contest | undefined {
  return store.contests.find((contest) => contest.id === contestId);
}

export function getContestForViewer(contestId: string, viewerId: string): Contest | undefined {
  const viewer = findUser(viewerId);
  const contest = getContestById(contestId);
  if (!contest) {
    return undefined;
  }

  const allowed = canViewVisibility(
    contest.visibility,
    contest.organizerId,
    viewerId,
    viewer?.role === "admin",
    true,
  );
  return allowed ? contest : undefined;
}

export function getContestStatus(contest: Contest): ContestStatus {
  const now = nowMs();
  const start = new Date(contest.startAt).getTime();
  const end = new Date(contest.endAt).getTime();
  if (now < start) {
    return "scheduled";
  }
  if (now <= end) {
    return "running";
  }
  return "ended";
}

export async function createContest(input: CreateContestInput): Promise<Contest> {
  uniqueSlugOrThrow("contest", input.slug);
  const user = await getCurrentUser();
  assertActiveUser(user);
  assertContestOrganizerOrAdmin(user);

  const timestamp = nowIso();
  const contest: Contest = {
    id: nextContestId(),
    organizerId: user.id,
    title: input.title.trim(),
    slug: toSlug(input.slug),
    descriptionMarkdown: input.descriptionMarkdown.trim(),
    visibility: input.visibility,
    startAt: input.startAt,
    endAt: input.endAt,
    penaltyMinutes: input.penaltyMinutes,
    scoreboardVisibility: input.scoreboardVisibility,
    problems: [...input.problems].sort((left, right) => left.orderIndex - right.orderIndex),
    participantUserIds: [user.id],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  store.contests.unshift(contest);
  return contest;
}

export async function updateContest(
  contestId: string,
  input: UpdateContestInput,
): Promise<Contest> {
  const user = await getCurrentUser();
  const contest = resolveContestIfExists(contestId);
  if (user.role !== "admin" && contest.organizerId !== user.id) {
    throw new HttpError("you cannot edit this contest", 403);
  }

  if (typeof input.slug === "string") {
    uniqueSlugOrThrow("contest", input.slug, contestId);
    contest.slug = toSlug(input.slug);
  }
  if (typeof input.title === "string" && input.title.trim()) {
    contest.title = input.title.trim();
  }
  if (typeof input.descriptionMarkdown === "string") {
    contest.descriptionMarkdown = input.descriptionMarkdown.trim();
  }
  if (input.visibility) {
    contest.visibility = input.visibility;
  }
  if (typeof input.startAt === "string") {
    contest.startAt = input.startAt;
  }
  if (typeof input.endAt === "string") {
    contest.endAt = input.endAt;
  }
  if (typeof input.penaltyMinutes === "number" && input.penaltyMinutes >= 0) {
    contest.penaltyMinutes = input.penaltyMinutes;
  }
  if (input.scoreboardVisibility) {
    contest.scoreboardVisibility = input.scoreboardVisibility;
  }
  if (Array.isArray(input.problems)) {
    contest.problems = [...input.problems].sort((left, right) => left.orderIndex - right.orderIndex);
  }

  contest.updatedAt = nowIso();
  return contest;
}

export async function joinContest(contestId: string): Promise<Contest> {
  const user = await getCurrentUser();
  assertActiveUser(user);
  const contest = resolveContestIfExists(contestId);
  if (getContestStatus(contest) === "ended") {
    throw new HttpError("cannot join an ended contest", 403);
  }
  if (!contest.participantUserIds.includes(user.id)) {
    contest.participantUserIds.push(user.id);
  }
  contest.updatedAt = nowIso();
  return contest;
}

interface ListSubmissionsOptions {
  userId?: string;
  problemId?: string;
  contestId?: string;
  language?: Language;
  status?: SubmissionStatus;
  limit?: number;
}

export function listSubmissionsForViewer(
  viewerId: string,
  options: ListSubmissionsOptions = {},
): Submission[] {
  void viewerId;
  repairJudgeQueueInternal();
  const filtered = [...store.submissions].filter((submission) => {
    if (options.userId && submission.userId !== options.userId) {
      return false;
    }
    if (options.problemId && submission.problemId !== options.problemId) {
      return false;
    }
    if (typeof options.contestId === "string") {
      if (options.contestId === "none") {
        if (submission.contestId !== null) {
          return false;
        }
      } else if (submission.contestId !== options.contestId) {
        return false;
      }
    }
    if (options.language && submission.language !== options.language) {
      return false;
    }
    if (options.status && submission.status !== options.status) {
      return false;
    }
    return true;
  });

  const sorted = filtered.sort(
    (left, right) =>
      new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
  );

  if (typeof options.limit === "number" && options.limit > 0) {
    return sorted.slice(0, options.limit);
  }
  return sorted;
}

export function listRecentSubmissions(limit = 15): Submission[] {
  repairJudgeQueueInternal();
  return [...store.submissions]
    .sort(
      (left, right) =>
        new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
    )
    .slice(0, limit);
}

export function getSubmissionById(submissionId: string): Submission | undefined {
  repairJudgeQueueInternal();
  return findSubmissionByIdInternal(submissionId);
}

export async function createSubmission(input: CreateSubmissionInput): Promise<Submission> {
  const currentUser = await getCurrentUser();
  assertActiveUser(currentUser);

  const problem = resolveProblemIfExists(input.problemId);
  if (!problem.supportedLanguages.includes(input.language)) {
    throw new HttpError("unsupported language", 400);
  }

  let contestId: string | null = null;
  if (input.contestId) {
    const contest = resolveContestIfExists(input.contestId);
    const contestStatus = getContestStatus(contest);
    if (contestStatus === "running") {
      if (!contest.participantUserIds.includes(currentUser.id)) {
        contest.participantUserIds.push(currentUser.id);
        contest.updatedAt = nowIso();
      }
      const included = contest.problems.some(
        (contestProblem) => contestProblem.problemId === problem.id,
      );
      if (!included) {
        throw new HttpError("problem is not included in this contest", 400);
      }
      contestId = contest.id;
    } else if (contestStatus === "scheduled") {
      throw new HttpError("contest submissions are allowed only while running", 403);
    }
  }

  if (!contestId) {
    const canSubmitProblem = canViewVisibility(
      problem.visibility,
      problem.authorId,
      currentUser.id,
      currentUser.role === "admin",
      true,
    );
    if (!canSubmitProblem) {
      throw new HttpError("you cannot submit to this problem", 403);
    }
  }

  enforceSubmissionRateLimit(currentUser.id, problem.id, isAdminBypass(currentUser));

  const submittedAt = nowIso();
  const submission: Submission = {
    id: nextSubmissionId(),
    userId: currentUser.id,
    problemId: problem.id,
    contestId,
    language: input.language,
    sourceCode: input.sourceCode,
    status: "pending",
    score: 0,
    totalTimeMs: 0,
    peakMemoryKb: 0,
    submittedAt,
    judgeStartedAt: null,
    judgedAt: null,
    judgeEnvironmentVersion: null,
    testResults: [],
  };

  store.submissions.unshift(submission);
  enqueueJudgeJob(submission.id, "normal");
  return submission;
}

function getWrongBeforeAccepted(
  orderedSubmissions: Submission[],
  acceptedAt: string | null,
): number {
  if (!acceptedAt) {
    return orderedSubmissions.filter(
      (submission) =>
        isFinalSubmissionStatus(submission.status) &&
        !isAcceptedSubmissionStatus(submission.status) &&
        submission.status !== "cancelled",
    ).length;
  }
  return orderedSubmissions.filter(
    (submission) =>
      isFinalSubmissionStatus(submission.status) &&
      !isAcceptedSubmissionStatus(submission.status) &&
      submission.status !== "cancelled" &&
      new Date(submission.submittedAt).getTime() < new Date(acceptedAt).getTime(),
  ).length;
}

function cellPenaltyMinutes(
  startAt: string,
  acceptedAt: string,
  wrongCount: number,
  penalty: number,
): number {
  const elapsedMs = Math.max(0, new Date(acceptedAt).getTime() - new Date(startAt).getTime());
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  return elapsedMinutes + wrongCount * penalty;
}

export function buildScoreboard(contestId: string): ScoreboardRow[] {
  const contest = resolveContestIfExists(contestId);
  const contestProblems = [...contest.problems].sort((left, right) => left.orderIndex - right.orderIndex);
  const contestStartMs = new Date(contest.startAt).getTime();
  const contestEndMs = new Date(contest.endAt).getTime();
  const inContestSubmissions = store.submissions.filter(
    (submission) => {
      if (submission.contestId !== contestId) {
        return false;
      }
      if (!isFinalSubmissionStatus(submission.status) || submission.status === "cancelled") {
        return false;
      }
      const submittedAtMs = new Date(submission.submittedAt).getTime();
      if (submittedAtMs < contestStartMs || submittedAtMs > contestEndMs) {
        return false;
      }
      return true;
    },
  );
  const participantIds = new Set<string>(contest.participantUserIds);

  const rows: ScoreboardRow[] = Array.from(participantIds).map((userId) => {
    const cells = contestProblems.map((contestProblem) => {
      const scoped = sortBySubmittedAtAsc(
        inContestSubmissions.filter(
          (submission) =>
            submission.userId === userId && submission.problemId === contestProblem.problemId,
        ),
      );

      const accepted = scoped.find((submission) => isAcceptedSubmissionStatus(submission.status));
      const acceptedAt = accepted?.submittedAt ?? null;
      const wrongSubmissions = getWrongBeforeAccepted(scoped, acceptedAt);
      const score = scoped.reduce((maxScore, submission) => Math.max(maxScore, submission.score), 0);

      return {
        label: contestProblem.label,
        score,
        acceptedAt,
        wrongSubmissions,
      };
    });

    const totalScore = cells.reduce((acc, cell) => acc + cell.score, 0);
    const penalty = cells.reduce((acc, cell) => {
      if (!cell.acceptedAt) {
        return acc;
      }
      return (
        acc +
        cellPenaltyMinutes(
          contest.startAt,
          cell.acceptedAt,
          cell.wrongSubmissions,
          contest.penaltyMinutes,
        )
      );
    }, 0);
    const acceptedTimes = cells
      .filter((cell) => cell.acceptedAt)
      .map((cell) => new Date(cell.acceptedAt as string).getTime());
    const lastAcceptedAt =
      acceptedTimes.length > 0 ? new Date(Math.max(...acceptedTimes)).toISOString() : null;

    return {
      userId,
      rank: 0,
      totalScore,
      penalty,
      lastAcceptedAt,
      cells,
    };
  });

  rows.sort((left, right) => {
    if (left.totalScore !== right.totalScore) {
      return right.totalScore - left.totalScore;
    }
    if (left.penalty !== right.penalty) {
      return left.penalty - right.penalty;
    }
    const leftLastAccepted = left.lastAcceptedAt
      ? new Date(left.lastAcceptedAt).getTime()
      : Number.POSITIVE_INFINITY;
    const rightLastAccepted = right.lastAcceptedAt
      ? new Date(right.lastAcceptedAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (leftLastAccepted !== rightLastAccepted) {
      return leftLastAccepted - rightLastAccepted;
    }
    return left.userId.localeCompare(right.userId);
  });

  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return rows;
}

export function canViewAnyScoreboard(contest: Contest): boolean {
  if (contest.scoreboardVisibility === "hidden") {
    return getContestStatus(contest) === "ended";
  }
  return true;
}

export function canViewScoreboardDetails(contest: Contest): boolean {
  if (contest.scoreboardVisibility === "full") {
    return true;
  }
  return getContestStatus(contest) === "ended";
}

export function buildVisibleScoreboard(contestId: string): {
  rows: ScoreboardRow[];
  detailLevel: "hidden" | "summary" | "full";
} {
  const contest = resolveContestIfExists(contestId);
  if (!canViewAnyScoreboard(contest)) {
    return {
      rows: [],
      detailLevel: "hidden",
    };
  }

  const rows = buildScoreboard(contestId);
  if (!canViewScoreboardDetails(contest)) {
    return {
      rows: rows.map((row) => ({
        ...row,
        cells: [],
      })),
      detailLevel: "summary",
    };
  }

  return {
    rows,
    detailLevel: "full",
  };
}

export function listContestProblems(
  contest: Contest,
): Array<ContestProblem & { problem: Problem | undefined }> {
  return [...contest.problems]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((contestProblem) => ({
      ...contestProblem,
      problem: getProblemById(contestProblem.problemId),
    }));
}

export function findUser(userId: string): User | undefined {
  return store.users.find((user) => user.id === userId);
}

export function canCreateProblemByRole(role: UserRole): boolean {
  return role === "admin" || role === "problem_author";
}

export function canCreateContestByRole(role: UserRole): boolean {
  return role === "admin" || role === "contest_organizer";
}

export function canCreateProblemByViewer(viewerId: string): boolean {
  const viewer = findUser(viewerId);
  return viewer ? canCreateProblemByRole(viewer.role) : false;
}

export function canCreateContestByViewer(viewerId: string): boolean {
  const viewer = findUser(viewerId);
  return viewer ? canCreateContestByRole(viewer.role) : false;
}

export function canEditProblemByViewer(problem: Problem, viewerId: string): boolean {
  const viewer = findUser(viewerId);
  if (!viewer) {
    return false;
  }
  return viewer.role === "admin" || problem.authorId === viewer.id;
}

export function canEditContestByViewer(contest: Contest, viewerId: string): boolean {
  const viewer = findUser(viewerId);
  if (!viewer) {
    return false;
  }
  return viewer.role === "admin" || contest.organizerId === viewer.id;
}

export function dumpStoreSnapshot(): {
  users: User[];
  problems: Problem[];
  contests: Contest[];
  submissions: Submission[];
  announcements: Announcement[];
  reports: Report[];
  auditLogs: AuditLog[];
  rejudgeRequests: RejudgeRequest[];
} {
  return {
    users: JSON.parse(JSON.stringify(store.users)) as User[],
    problems: JSON.parse(JSON.stringify(store.problems)) as Problem[],
    contests: JSON.parse(JSON.stringify(store.contests)) as Contest[],
    submissions: JSON.parse(JSON.stringify(store.submissions)) as Submission[],
    announcements: JSON.parse(JSON.stringify(store.announcements)) as Announcement[],
    reports: JSON.parse(JSON.stringify(store.reports)) as Report[],
    auditLogs: JSON.parse(JSON.stringify(store.auditLogs)) as AuditLog[],
    rejudgeRequests: JSON.parse(JSON.stringify(store.rejudgeRequests)) as RejudgeRequest[],
  };
}

export function canViewSubmissionSource(submission: Submission, viewerId: string): boolean {
  const viewer = findUser(viewerId);
  return viewer?.role === "admin" || submission.userId === viewerId;
}

function maskSensitiveJudgeMessage(
  result: Submission["testResults"][number],
  canViewSource: boolean,
): Submission["testResults"][number] {
  if (canViewSource) {
    return result;
  }

  if (result.verdict === "compilation_error" || result.verdict === "internal_error") {
    return {
      ...result,
      message: "details hidden",
    };
  }

  return result;
}

function buildCaseIndexOnlyResults(
  results: Submission["testResults"],
): Submission["testResults"] {
  const caseIndexByGroup: Record<string, number> = {};
  return results.map((result) => {
    const nextIndex = (caseIndexByGroup[result.groupName] ?? 0) + 1;
    caseIndexByGroup[result.groupName] = nextIndex;
    return {
      ...result,
      testCaseName: `#${nextIndex}`,
    };
  });
}

function pickSummaryVerdict(groupResults: Submission["testResults"]): SubmissionStatus {
  return pickHighestPriorityVerdict(groupResults.map((result) => result.verdict));
}

function buildGroupOnlyResults(results: Submission["testResults"]): Submission["testResults"] {
  const grouped = new Map<string, Submission["testResults"]>();
  for (const result of results) {
    const entries = grouped.get(result.groupName) ?? [];
    entries.push(result);
    grouped.set(result.groupName, entries);
  }

  return [...grouped.entries()].map(([groupName, groupResults], index) => {
    const verdict = pickSummaryVerdict(groupResults);
    const totalTimeMs = groupResults.reduce((acc, result) => acc + result.timeMs, 0);
    const peakMemoryKb = groupResults.reduce((max, result) => Math.max(max, result.memoryKb), 0);

    return {
      id: `group-summary-${groupName}-${index}`,
      groupName,
      testCaseName: "-",
      verdict,
      timeMs: totalTimeMs,
      memoryKb: peakMemoryKb,
      message: isAcceptedSubmissionStatus(verdict)
        ? "Accepted (group summary)"
        : `${verdict} (group summary)`,
    };
  });
}

function applyTestCaseVisibilityPolicy(
  submission: Submission,
  canViewSource: boolean,
): Submission["testResults"] {
  const problem = getProblemById(submission.problemId);
  const visibility = problem?.testCaseVisibility ?? "case_index_only";
  const base = submission.testResults.map((result) =>
    maskSensitiveJudgeMessage(result, canViewSource),
  );

  if (canViewSource || visibility === "case_name_visible") {
    return base;
  }
  if (visibility === "group_only") {
    return buildGroupOnlyResults(base);
  }
  return buildCaseIndexOnlyResults(base);
}

export function canRequestRejudgeByViewer(
  submission: Submission,
  viewerId: string,
): boolean {
  const viewer = findUser(viewerId);
  if (!viewer) {
    return false;
  }
  if (viewer.role === "admin") {
    return true;
  }

  const problem = getProblemById(submission.problemId);
  if (problem?.authorId === viewerId) {
    return true;
  }

  if (submission.contestId) {
    const contest = getContestById(submission.contestId);
    if (contest?.organizerId === viewerId) {
      return true;
    }
  }

  return false;
}

export function getSubmissionWithAccess(
  submissionId: string,
  viewerId: string,
): { submission: Submission; canViewSource: boolean } | undefined {
  const submission = getSubmissionById(submissionId);
  if (!submission) {
    return undefined;
  }

  const canViewSource = canViewSubmissionSource(submission, viewerId);
  const visibleTestResults = applyTestCaseVisibilityPolicy(submission, canViewSource);
  if (canViewSource) {
    return {
      submission: {
        ...submission,
        testResults: visibleTestResults,
      },
      canViewSource: true,
    };
  }

  return {
    submission: {
      ...submission,
      sourceCode: "// source code is hidden",
      testResults: visibleTestResults,
    },
    canViewSource: false,
  };
}

export async function createReport(input: CreateReportInput): Promise<Report> {
  const reporter = await getCurrentUser();
  assertActiveUser(reporter);

  if (!input.reason.trim()) {
    throw new HttpError("report reason is required", 400);
  }

  if (input.targetType === "problem") {
    resolveProblemIfExists(input.targetId);
  } else if (input.targetType === "contest") {
    resolveContestIfExists(input.targetId);
  } else {
    resolveSubmissionIfExists(input.targetId);
  }

  const timestamp = nowIso();
  const report: Report = {
    id: nextReportId(),
    reporterId: reporter.id,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason.trim(),
    detail: input.detail.trim(),
    status: "open",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  store.reports.unshift(report);
  appendAuditLog({
    actorId: reporter.id,
    action: "report.create",
    targetType: input.targetType,
    targetId: input.targetId,
    reason: report.reason,
    metadata: { reportId: report.id },
  });

  return report;
}

export async function listReportsForAdmin(): Promise<Report[]> {
  const user = await getCurrentUser();
  assertAdmin(user);
  return [...store.reports].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export async function updateReportStatusByAdmin(
  reportId: string,
  status: ReportStatus,
  reason: string,
): Promise<Report> {
  const user = await getCurrentUser();
  assertAdmin(user);
  const report = store.reports.find((item) => item.id === reportId);
  if (!report) {
    throw new HttpError("report not found", 404);
  }

  report.status = status;
  report.updatedAt = nowIso();

  appendAuditLog({
    actorId: user.id,
    action: "report.status.update",
    targetType: "report",
    targetId: report.id,
    reason: reason || `status changed to ${status}`,
    metadata: { status },
  });

  return report;
}

export async function freezeUserByAdmin(userId: string, reason: string): Promise<User> {
  const admin = await getCurrentUser();
  assertAdmin(admin);
  const target = findUserOrThrow(userId);
  if (target.role === "admin") {
    throw new HttpError("cannot freeze admin user", 400);
  }
  target.status = "frozen";
  target.updatedAt = nowIso();

  appendAuditLog({
    actorId: admin.id,
    action: "admin.user.freeze",
    targetType: "user",
    targetId: target.id,
    reason: reason || "user frozen by admin",
  });

  return target;
}

export async function unfreezeUserByAdmin(userId: string, reason: string): Promise<User> {
  const admin = await getCurrentUser();
  assertAdmin(admin);
  const target = findUserOrThrow(userId);
  if (target.role === "admin") {
    throw new HttpError("cannot unfreeze admin user", 400);
  }
  target.status = "active";
  target.updatedAt = nowIso();

  appendAuditLog({
    actorId: admin.id,
    action: "admin.user.unfreeze",
    targetType: "user",
    targetId: target.id,
    reason: reason || "user unfrozen by admin",
  });

  return target;
}

export async function updateUserRoleByAdmin(
  userId: string,
  role: UserRole,
  reason: string,
): Promise<User> {
  const admin = await getCurrentUser();
  assertAdmin(admin);
  const target = findUserOrThrow(userId);
  if (target.role === "admin") {
    throw new HttpError("cannot update admin role", 400);
  }
  if (role === "admin" || role === "guest") {
    throw new HttpError("invalid role for manual assignment", 400);
  }

  const previousRole = target.role;
  target.role = role;
  target.updatedAt = nowIso();

  appendAuditLog({
    actorId: admin.id,
    action: "admin.user.role.update",
    targetType: "user",
    targetId: target.id,
    reason: reason || "user role updated by admin",
    metadata: {
      previousRole,
      nextRole: role,
    },
  });

  return target;
}

export async function createAnnouncementByAdmin(
  input: CreateAnnouncementInput,
  reason: string,
): Promise<Announcement> {
  const admin = await getCurrentUser();
  assertAdmin(admin);

  const title = input.title.trim();
  if (!title) {
    throw new HttpError("announcement title is required", 400);
  }

  const announcement: Announcement = {
    id: nextAnnouncementId(),
    title,
    body: input.body.trim(),
    isHidden: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.announcements.unshift(announcement);

  appendAuditLog({
    actorId: admin.id,
    action: "admin.announcement.create",
    targetType: "announcement",
    targetId: announcement.id,
    reason: reason || "announcement created by admin",
  });

  return announcement;
}

export async function hideAnnouncementByAdmin(
  announcementId: string,
  reason: string,
): Promise<Announcement> {
  const admin = await getCurrentUser();
  assertAdmin(admin);
  const announcement = store.announcements.find((item) => item.id === announcementId);
  if (!announcement) {
    throw new HttpError("announcement not found", 404);
  }

  announcement.isHidden = true;
  announcement.updatedAt = nowIso();

  appendAuditLog({
    actorId: admin.id,
    action: "admin.announcement.hide",
    targetType: "announcement",
    targetId: announcement.id,
    reason: reason || "announcement hidden by admin",
  });

  return announcement;
}

export async function hideProblemByAdmin(
  problemId: string,
  reason: string,
): Promise<Problem> {
  const admin = await getCurrentUser();
  assertAdmin(admin);
  const problem = resolveProblemIfExists(problemId);
  problem.visibility = "private";
  problem.updatedAt = nowIso();

  appendAuditLog({
    actorId: admin.id,
    action: "admin.problem.hide",
    targetType: "problem",
    targetId: problem.id,
    reason: reason || "problem hidden by admin",
  });

  return problem;
}

export async function hideProblemExplanationByAdmin(
  problemId: string,
  reason: string,
): Promise<Problem> {
  const admin = await getCurrentUser();
  assertAdmin(admin);
  const problem = resolveProblemIfExists(problemId);
  problem.explanationVisibility = "private";
  problem.updatedAt = nowIso();

  appendAuditLog({
    actorId: admin.id,
    action: "admin.problem.explanation.hide",
    targetType: "problem",
    targetId: problem.id,
    reason: reason || "problem explanation hidden by admin",
  });

  return problem;
}

export async function hideContestByAdmin(
  contestId: string,
  reason: string,
): Promise<Contest> {
  const admin = await getCurrentUser();
  assertAdmin(admin);
  const contest = resolveContestIfExists(contestId);
  contest.visibility = "private";
  contest.updatedAt = nowIso();

  appendAuditLog({
    actorId: admin.id,
    action: "admin.contest.hide",
    targetType: "contest",
    targetId: contest.id,
    reason: reason || "contest hidden by admin",
  });

  return contest;
}

export async function getJudgeQueueStatsForAdmin(): Promise<{
  queuedJobs: number;
  waitingSubmissions: number;
  running: boolean;
}> {
  const user = await getCurrentUser();
  assertAdmin(user);
  repairJudgeQueueInternal();
  return getJudgeQueueStatsInternal();
}

export async function getJudgeQueueDiagnosticsForAdmin(limit = 50): Promise<{
  stats: {
    queuedJobs: number;
    waitingSubmissions: number;
    running: boolean;
  };
  jobs: Array<{
    id: string;
    submissionId: string;
    queuedAt: string;
    reason: JudgeJobReason;
    requestedAt: string;
  }>;
  orphanWaitingSubmissionIds: string[];
}> {
  const user = await getCurrentUser();
  assertAdmin(user);
  return getJudgeQueueDiagnosticsInternal(limit);
}

export async function repairJudgeQueueByAdmin(): Promise<{
  requeued: number;
  diagnostics: {
    stats: {
      queuedJobs: number;
      waitingSubmissions: number;
      running: boolean;
    };
    jobs: Array<{
      id: string;
      submissionId: string;
      queuedAt: string;
      reason: JudgeJobReason;
      requestedAt: string;
    }>;
    orphanWaitingSubmissionIds: string[];
  };
}> {
  const user = await getCurrentUser();
  assertAdmin(user);
  const requeued = repairJudgeQueueInternal();
  return {
    requeued,
    diagnostics: getJudgeQueueDiagnosticsInternal(),
  };
}

export async function listAuditLogsForAdmin(limit = 100): Promise<AuditLog[]> {
  const user = await getCurrentUser();
  assertAdmin(user);
  return [...store.auditLogs]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

export async function listRejudgeRequestsForAdmin(limit = 50): Promise<RejudgeRequest[]> {
  const user = await getCurrentUser();
  assertAdmin(user);
  return [...store.rejudgeRequests]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

export async function requestRejudge(input: RequestRejudgeInput): Promise<{
  request: RejudgeRequest;
  submission: Submission;
}> {
  const actor = await getCurrentUser();
  assertActiveUser(actor);
  if (!input.reason.trim()) {
    throw new HttpError("rejudge reason is required", 400);
  }

  const submission = resolveSubmissionIfExists(input.submissionId);
  const problem = resolveProblemIfExists(submission.problemId);
  const contest = submission.contestId ? getContestById(submission.contestId) : undefined;

  const canRequest =
    actor.role === "admin" ||
    problem.authorId === actor.id ||
    (contest ? contest.organizerId === actor.id : false);
  if (!canRequest) {
    throw new HttpError("you do not have permission to request rejudge", 403);
  }

  enforceRejudgeRateLimit(actor.id, problem.id, isAdminBypass(actor));

  submission.status = "pending";
  submission.score = 0;
  submission.totalTimeMs = 0;
  submission.peakMemoryKb = 0;
  submission.judgeStartedAt = null;
  submission.judgedAt = null;
  submission.judgeEnvironmentVersion = null;
  submission.testResults = [];

  const request: RejudgeRequest = {
    id: nextRejudgeId(),
    requestedBy: actor.id,
    submissionId: submission.id,
    problemId: problem.id,
    reason: input.reason.trim(),
    detail: input.detail.trim(),
    createdAt: nowIso(),
  };
  store.rejudgeRequests.unshift(request);

  appendAuditLog({
    actorId: actor.id,
    action: "submission.rejudge.request",
    targetType: "submission",
    targetId: submission.id,
    reason: request.reason,
    metadata: { requestId: request.id, problemId: problem.id },
  });

  enqueueJudgeJob(submission.id, "rejudge");

  return { request, submission };
}

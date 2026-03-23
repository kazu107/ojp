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
import { Prisma } from "@prisma/client";
import {
  buildEditorDraftFromExtracted,
  buildProblemPackageZip,
  type ProblemPackageExtracted,
  type ProblemPackageManifest,
} from "@/lib/problem-package";
import { validateProblemPackageCached } from "@/lib/problem-package-cache";
import { executePackageJudge } from "@/lib/judge-runtime";
import { getJudgeEnvironmentVersion } from "@/lib/judge-config";
import { createLazyProblemPackageSourceFromStorageRef } from "@/lib/problem-package-lazy";
import {
  deleteProblemPackageZip,
  getProblemPackageZip,
  isProblemPackageObjectStorageEnabled,
  putProblemPackageZip,
  type ProblemPackageStorageRef,
} from "@/lib/problem-package-storage";
import {
  isAcceptedSubmissionStatus,
  isFinalSubmissionStatus,
  isWaitingSubmissionStatus,
  normalizeSubmissionStatus,
  pickHighestPriorityVerdict,
} from "@/lib/submission-status";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

const SUBMISSION_COOLDOWN_MS = 10_000;
const SUBMISSION_LIMIT_WINDOW_MS = 60_000;
const SUBMISSION_LIMIT_PER_WINDOW = 20;

const REJUDGE_COOLDOWN_MS = 60_000;
const REJUDGE_LIMIT_WINDOW_MS = 60_000;
const REJUDGE_LIMIT_PER_WINDOW = 3;

const DISPLAY_NAME_CHANGE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const STORE_STATE_ID = "default";
const STORE_PERSIST_INTERVAL_MS = 3_000;
const STORE_REFRESH_INTERVAL_MS = 1_000;
const PROBLEM_PACKAGE_MEMORY_CACHE_LIMIT = 2;
const PROBLEM_PACKAGE_MEMORY_CACHE_MAX_ZIP_BYTES = 4 * 1024 * 1024;
const STORE_DB_SYNC_ENABLED = process.env.STORE_DB_SYNC !== "0";
const JUDGE_PROCESS_MODE =
  process.env.JUDGE_PROCESS_MODE === "web" ||
  process.env.JUDGE_PROCESS_MODE === "worker"
    ? process.env.JUDGE_PROCESS_MODE
    : "inline";
const DEDICATED_JUDGE_POLL_INTERVAL_MS = 1_000;
const APP_STATE_WRITE_LEASE_ID = "app-state-write";
const WORKER_LEASE_DURATION_MS = 15_000;
const JOB_CLAIM_STALE_MS = 10 * 60_000;
const JOB_HEARTBEAT_INTERVAL_MS = 10_000;
const WORKER_INSTANCE_ID =
  process.env.DYNO?.trim() ||
  `worker-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;

function parseCsvEnvSet(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set<string>();
  }
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

const ADMIN_GITHUB_LOGINS = parseCsvEnvSet(process.env.ADMIN_GITHUB_LOGINS);
const ADMIN_GITHUB_IDS = parseCsvEnvSet(process.env.ADMIN_GITHUB_IDS);

function shouldGrantAdminFromGitHub(params: { githubLogin: string; githubId?: string }): boolean {
  const login = params.githubLogin.trim().toLowerCase();
  if (login && ADMIN_GITHUB_LOGINS.has(login)) {
    return true;
  }

  const githubId = params.githubId?.trim().toLowerCase();
  if (githubId && ADMIN_GITHUB_IDS.has(githubId)) {
    return true;
  }

  return false;
}
type JudgeJobReason = "normal" | "rejudge";
type PackageJobStatus = "queued" | "running" | "completed" | "failed";

interface PackageJobPreviewResult {
  status: SubmissionStatus;
  score: number;
  totalTimeMs: number;
  peakMemoryKb: number;
  testResults: Submission["testResults"];
}

type PackageJobRecord =
  | {
      id: string;
      type: "apply";
      requestedBy: string;
      status: PackageJobStatus;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      error: string | null;
      problemId: string;
      fileName: string;
      storageRef: ProblemPackageStorageRef;
      previousRef: ProblemPackageStorageRef | null;
      result: {
        problemId: string;
      } | null;
    }
  | {
      id: string;
      type: "preview";
      requestedBy: string;
      status: PackageJobStatus;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      error: string | null;
      problemId: string | null;
      fileName: string;
      storageRef: ProblemPackageStorageRef;
      language: Language;
      sourceCode: string;
      timeLimitMs: number;
      memoryLimitMb: number;
      result: PackageJobPreviewResult | null;
    };

interface RateLimits {
  submissionByUserWindow: Record<string, number[]>;
  submissionCooldownByProblem: Record<string, number>;
  rejudgeByUserWindow: Record<string, number[]>;
  rejudgeCooldownByProblem: Record<string, number>;
}

interface SubmissionRuntimeSummary {
  status: SubmissionStatus;
  score: number;
  totalTimeMs: number;
  peakMemoryKb: number;
  judgeStartedAt: string | null;
  judgedAt: string | null;
  judgeEnvironmentVersion: string | null;
}

export interface ProblemPackageCaseManifest {
  groups: Array<{
    name: string;
    caseNames: string[];
  }>;
}

interface Store {
  users: User[];
  problems: Problem[];
  problemPackages: Record<string, ProblemPackageExtracted>;
  problemPackageRefs: Record<string, ProblemPackageStorageRef>;
  contests: Contest[];
  submissions: Submission[];
  announcements: Announcement[];
  reports: Report[];
  auditLogs: AuditLog[];
  rejudgeRequests: RejudgeRequest[];
  githubIndex: Record<string, string>;
  packageJobs: PackageJobRecord[];
  packageJobQueue: string[];
  packageJobWorkerRunning: boolean;
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
    packageJob: number;
  };
  rateLimits: RateLimits;
}

interface StoreSnapshot {
  users: User[];
  problems: Problem[];
  problemPackages: Record<string, ProblemPackageExtracted>;
  problemPackageRefs: Record<string, ProblemPackageStorageRef>;
  contests: Contest[];
  submissions: Submission[];
  announcements: Announcement[];
  reports: Report[];
  auditLogs: AuditLog[];
  rejudgeRequests: RejudgeRequest[];
  githubIndex: Record<string, string>;
  counters: Store["counters"];
  rateLimits: RateLimits;
}

const globalStore = globalThis as unknown as {
  __ojpStore?: Store;
  __ojpStoreDbHydrationStarted?: boolean;
  __ojpStoreDbHydrated?: boolean;
  __ojpStorePersistIntervalStarted?: boolean;
  __ojpStoreRefreshIntervalStarted?: boolean;
  __ojpStoreLastPersistedSnapshotJson?: string;
  __ojpStorePersistInFlight?: boolean;
  __ojpStorePersistQueued?: boolean;
  __ojpDedicatedJudgeLoopStarted?: boolean;
  __ojpProblemPackageCacheOrder?: string[];
  __ojpSubmissionRuntimeCache?: Record<string, SubmissionRuntimeSummary>;
  __ojpSubmissionRuntimeCacheRefreshInFlight?: boolean;
  __ojpSubmissionRuntimeCacheLastRefreshAt?: number;
  __ojpStoreLastSeenDbUpdatedAt?: string;
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

function canExecuteJudgeJobsInThisProcess(): boolean {
  return JUDGE_PROCESS_MODE === "inline" || JUDGE_PROCESS_MODE === "worker";
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
      difficulty: 100,
      timeLimitMs: 2000,
      memoryLimitMb: 512,
      scoringType: "sum",
      testCaseVisibility: "case_index_only",
      latestPackageSummary: null,
      sampleCases: [],
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
      difficulty: 400,
      timeLimitMs: 2000,
      memoryLimitMb: 512,
      scoringType: "sum",
      testCaseVisibility: "case_index_only",
      latestPackageSummary: null,
      sampleCases: [],
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
          checkerLanguage: null,
          compareMode: "exact",
          problem: {
            slug: null,
            visibility: null,
            explanationVisibility: null,
            difficulty: null,
            testCaseVisibility: null,
          },
          samples: [
            { name: "sample1", description: "" },
            { name: "sample2", description: "" },
          ],
          groups: [{ name: "group1", score: 100, tests: 2 }],
        },
        warnings: ["seed package (embedded)"],
      },
      scoringType: "sum_of_groups",
      checkerType: "exact",
      checkerLanguage: null,
      checkerSourceCode: null,
      compareMode: "exact",
      samples: [
        {
          name: "sample1",
          description: "",
          input: "1\n",
          output: "1\n",
        },
        {
          name: "sample2",
          description: "",
          input: "42\n",
          output: "42\n",
        },
      ],
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
          checkerLanguage: null,
          compareMode: "exact",
          problem: {
            slug: null,
            visibility: null,
            explanationVisibility: null,
            difficulty: null,
            testCaseVisibility: null,
          },
          samples: [
            { name: "sample1", description: "" },
            { name: "sample2", description: "" },
          ],
          groups: [{ name: "group1", score: 100, tests: 2 }],
        },
        warnings: ["seed package (embedded)"],
      },
      scoringType: "sum_of_groups",
      checkerType: "exact",
      checkerLanguage: null,
      checkerSourceCode: null,
      compareMode: "exact",
      samples: [
        {
          name: "sample1",
          description: "",
          input: "1 2 3\n",
          output: "6\n",
        },
        {
          name: "sample2",
          description: "",
          input: "-5 6 7\n",
          output: "8\n",
        },
      ],
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
    problemPackageRefs: {},
    contests,
    submissions,
    announcements,
    reports,
    auditLogs,
    rejudgeRequests: [],
    githubIndex: {},
    packageJobs: [],
    packageJobQueue: [],
    packageJobWorkerRunning: false,
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
      packageJob: 1000,
    },
    rateLimits: {
      submissionByUserWindow: {},
      submissionCooldownByProblem: {},
      rejudgeByUserWindow: {},
      rejudgeCooldownByProblem: {},
    },
  };
}

function normalizeStoreInPlace(target: Store): void {
  if (!Array.isArray(target.packageJobs)) {
    target.packageJobs = [];
  }
  if (!Array.isArray(target.packageJobQueue)) {
    target.packageJobQueue = [];
  }
  if (typeof target.packageJobWorkerRunning !== "boolean") {
    target.packageJobWorkerRunning = false;
  }
  if (!Array.isArray(target.judgeQueue)) {
    target.judgeQueue = [];
  }
  for (const job of target.judgeQueue) {
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
  if (!Array.isArray(target.judgeInFlightSubmissionIds)) {
    target.judgeInFlightSubmissionIds = [];
  }
  if (typeof target.judgeWorkerRunning !== "boolean") {
    target.judgeWorkerRunning = false;
  }
  if (typeof target.counters.judgeJob !== "number") {
    target.counters.judgeJob = 1000;
  }
  if (typeof target.counters.packageJob !== "number") {
    target.counters.packageJob = 1000;
  }
  if (!target.problemPackages || typeof target.problemPackages !== "object") {
    target.problemPackages = {};
  }
  if (!target.problemPackageRefs || typeof target.problemPackageRefs !== "object") {
    target.problemPackageRefs = {};
  }
  for (const packageData of Object.values(target.problemPackages)) {
    const legacyPackage = packageData as ProblemPackageExtracted & {
      checkerType?: "exact" | "special_judge";
      checkerLanguage?: Language | null;
      checkerSourceCode?: string | null;
      validation: ProblemPackageExtracted["validation"] & {
        config: ProblemPackageExtracted["validation"]["config"] & {
          checkerType?: "exact" | "special_judge";
          checkerLanguage?: Language | null;
        };
      };
    };

    if (!legacyPackage.checkerType) {
      legacyPackage.checkerType = "exact";
    }
    if (legacyPackage.checkerLanguage === undefined) {
      legacyPackage.checkerLanguage = null;
    }
    if (legacyPackage.checkerSourceCode === undefined) {
      legacyPackage.checkerSourceCode = null;
    }
    if (!legacyPackage.validation.config.checkerType) {
      legacyPackage.validation.config.checkerType = legacyPackage.checkerType;
    }
    if (legacyPackage.validation.config.checkerLanguage === undefined) {
      legacyPackage.validation.config.checkerLanguage = legacyPackage.checkerLanguage;
    }
    legacyPackage.samples = legacyPackage.samples.map((sample) => ({
      ...sample,
      description: typeof sample.description === "string" ? sample.description : "",
    }));
  }
  if (!Array.isArray(target.announcements)) {
    target.announcements = [];
  }
  if (typeof target.counters.announcement !== "number") {
    target.counters.announcement = 1000;
  }
  for (const problem of target.problems) {
    if (!problem.explanationVisibility) {
      problem.explanationVisibility = "private";
    }
    if (!problem.testCaseVisibility) {
      problem.testCaseVisibility = "case_index_only";
    }
    if (
      problem.difficulty !== null &&
      !(typeof problem.difficulty === "number" && Number.isFinite(problem.difficulty))
    ) {
      problem.difficulty = null;
    } else if (typeof problem.difficulty === "number") {
      problem.difficulty = Math.trunc(problem.difficulty);
    }
    const legacyProblem = problem as Problem & {
      difficulty?: number | null;
      latestPackageSummary?: Problem["latestPackageSummary"];
      sampleCases?: Problem["sampleCases"];
    };
    if (legacyProblem.difficulty === undefined) {
      legacyProblem.difficulty = null;
    }
    if (legacyProblem.latestPackageSummary === undefined) {
      legacyProblem.latestPackageSummary = null;
    }
    if (!Array.isArray(legacyProblem.sampleCases)) {
      legacyProblem.sampleCases = target.problemPackages[problem.id]?.samples.map((sample) => ({
        name: sample.name,
        description: sample.description,
        input: sample.input,
        output: sample.output,
      })) ?? [];
    }
  }
  for (const submission of target.submissions) {
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
}

function captureStoreSnapshot(target: Store): StoreSnapshot {
  return JSON.parse(
    JSON.stringify({
      users: target.users,
      problems: target.problems,
      problemPackages: isProblemPackageObjectStorageEnabled() ? {} : target.problemPackages,
      problemPackageRefs: target.problemPackageRefs,
      contests: target.contests,
      submissions: target.submissions,
      announcements: target.announcements,
      reports: target.reports,
      auditLogs: target.auditLogs,
      rejudgeRequests: target.rejudgeRequests,
      githubIndex: target.githubIndex,
      counters: target.counters,
      rateLimits: target.rateLimits,
    }),
  ) as StoreSnapshot;
}

function applyStoreSnapshotInPlace(target: Store, snapshot: StoreSnapshot): void {
  target.users = Array.isArray(snapshot.users) ? snapshot.users : [];
  target.problems = Array.isArray(snapshot.problems) ? snapshot.problems : [];
  target.problemPackages =
    snapshot.problemPackages && typeof snapshot.problemPackages === "object"
      ? snapshot.problemPackages
      : {};
  target.problemPackageRefs =
    snapshot.problemPackageRefs && typeof snapshot.problemPackageRefs === "object"
      ? snapshot.problemPackageRefs
      : {};
  target.contests = Array.isArray(snapshot.contests) ? snapshot.contests : [];
  target.submissions = Array.isArray(snapshot.submissions) ? snapshot.submissions : [];
  target.announcements = Array.isArray(snapshot.announcements) ? snapshot.announcements : [];
  target.reports = Array.isArray(snapshot.reports) ? snapshot.reports : [];
  target.auditLogs = Array.isArray(snapshot.auditLogs) ? snapshot.auditLogs : [];
  target.rejudgeRequests = Array.isArray(snapshot.rejudgeRequests) ? snapshot.rejudgeRequests : [];
  target.githubIndex =
    snapshot.githubIndex && typeof snapshot.githubIndex === "object" ? snapshot.githubIndex : {};
  target.packageJobs = [];
  target.packageJobQueue = [];
  target.judgeQueue = [];
  target.counters = {
    ...target.counters,
    ...(snapshot.counters ?? {}),
  };
  target.rateLimits = {
    submissionByUserWindow: snapshot.rateLimits?.submissionByUserWindow ?? {},
    submissionCooldownByProblem: snapshot.rateLimits?.submissionCooldownByProblem ?? {},
    rejudgeByUserWindow: snapshot.rateLimits?.rejudgeByUserWindow ?? {},
    rejudgeCooldownByProblem: snapshot.rateLimits?.rejudgeCooldownByProblem ?? {},
  };
  target.packageJobWorkerRunning = false;
  target.judgeInFlightSubmissionIds = [];
  target.judgeWorkerRunning = false;
  globalStore.__ojpProblemPackageCacheOrder = Object.keys(target.problemPackages);
}

function forgetProblemPackageData(problemId: string): void {
  delete store.problemPackages[problemId];
  globalStore.__ojpProblemPackageCacheOrder = (
    globalStore.__ojpProblemPackageCacheOrder ?? []
  ).filter((entry) => entry !== problemId);
}

function rememberProblemPackageData(
  problemId: string,
  packageData: ProblemPackageExtracted,
): void {
  if (packageData.validation.zipSizeBytes > PROBLEM_PACKAGE_MEMORY_CACHE_MAX_ZIP_BYTES) {
    forgetProblemPackageData(problemId);
    return;
  }

  store.problemPackages[problemId] = packageData;
  const order = (globalStore.__ojpProblemPackageCacheOrder ?? []).filter(
    (entry) => entry !== problemId,
  );
  order.push(problemId);
  while (order.length > PROBLEM_PACKAGE_MEMORY_CACHE_LIMIT) {
    const evicted = order.shift();
    if (evicted) {
      delete store.problemPackages[evicted];
    }
  }
  globalStore.__ojpProblemPackageCacheOrder = order;
}

async function persistStoreSnapshotNow(): Promise<void> {
  if (!STORE_DB_SYNC_ENABLED) {
    return;
  }
  if (!globalStore.__ojpStoreDbHydrated) {
    return;
  }
  if (globalStore.__ojpStorePersistInFlight) {
    globalStore.__ojpStorePersistQueued = true;
    return;
  }

  globalStore.__ojpStorePersistInFlight = true;
  try {
    const snapshot = captureStoreSnapshot(store);
    const snapshotJson = JSON.stringify(snapshot);
    if (snapshotJson === globalStore.__ojpStoreLastPersistedSnapshotJson) {
      return;
    }

    await prisma.appState.upsert({
      where: { id: STORE_STATE_ID },
      update: { snapshot: snapshot as unknown as Prisma.InputJsonValue },
      create: {
        id: STORE_STATE_ID,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    globalStore.__ojpStoreLastPersistedSnapshotJson = snapshotJson;
  } catch (error) {
    console.error("[store] failed to persist app state:", error);
  } finally {
    globalStore.__ojpStorePersistInFlight = false;
    if (globalStore.__ojpStorePersistQueued) {
      globalStore.__ojpStorePersistQueued = false;
      queueMicrotask(() => {
        void persistStoreSnapshotNow();
      });
    }
  }
}

async function hydrateStoreFromDb(): Promise<void> {
  if (!STORE_DB_SYNC_ENABLED) {
    globalStore.__ojpStoreDbHydrated = true;
    return;
  }
  try {
    const state = await prisma.appState.findUnique({
      where: { id: STORE_STATE_ID },
    });
    if (!state) {
      globalStore.__ojpStoreDbHydrated = true;
      await persistStoreSnapshotNow();
      return;
    }

    const snapshot = state.snapshot;
    if (!snapshot || typeof snapshot !== "object") {
      globalStore.__ojpStoreDbHydrated = true;
      await persistStoreSnapshotNow();
      return;
    }

    applyStoreSnapshotInPlace(store, snapshot as unknown as StoreSnapshot);
    normalizeStoreInPlace(store);
    globalStore.__ojpStoreLastPersistedSnapshotJson = JSON.stringify(captureStoreSnapshot(store));
    globalStore.__ojpStoreLastSeenDbUpdatedAt = state.updatedAt.toISOString();
    globalStore.__ojpStoreDbHydrated = true;
  } catch (error) {
    console.error("[store] failed to hydrate app state:", error);
    globalStore.__ojpStoreDbHydrated = true;
  }
}

async function refreshStoreFromDbNow(): Promise<void> {
  if (!STORE_DB_SYNC_ENABLED) {
    return;
  }
  const meta = await prisma.appState.findUnique({
    where: { id: STORE_STATE_ID },
    select: { updatedAt: true },
  });
  if (!meta) {
    return;
  }
  const nextUpdatedAt = meta.updatedAt.toISOString();
  if (globalStore.__ojpStoreLastSeenDbUpdatedAt === nextUpdatedAt) {
    return;
  }

  const state = await prisma.appState.findUnique({
    where: { id: STORE_STATE_ID },
    select: { snapshot: true, updatedAt: true },
  });
  if (!state || !state.snapshot || typeof state.snapshot !== "object") {
    return;
  }

  applyStoreSnapshotInPlace(store, state.snapshot as unknown as StoreSnapshot);
  normalizeStoreInPlace(store);
  globalStore.__ojpStoreLastPersistedSnapshotJson = JSON.stringify(captureStoreSnapshot(store));
  globalStore.__ojpStoreLastSeenDbUpdatedAt = state.updatedAt.toISOString();
  globalStore.__ojpStoreDbHydrated = true;
}

function startStorePersistenceLoop(): void {
  if (!STORE_DB_SYNC_ENABLED || globalStore.__ojpStorePersistIntervalStarted) {
    return;
  }
  if (JUDGE_PROCESS_MODE === "worker") {
    return;
  }
  globalStore.__ojpStorePersistIntervalStarted = true;
  const interval = setInterval(() => {
    void persistStoreSnapshotNow();
  }, STORE_PERSIST_INTERVAL_MS);
  interval.unref?.();
}

function startStoreRefreshLoop(): void {
  if (!STORE_DB_SYNC_ENABLED || JUDGE_PROCESS_MODE !== "web") {
    return;
  }
  if (globalStore.__ojpStoreRefreshIntervalStarted) {
    return;
  }

  globalStore.__ojpStoreRefreshIntervalStarted = true;
  const interval = setInterval(() => {
    if (!globalStore.__ojpStoreDbHydrated || globalStore.__ojpStorePersistInFlight) {
      return;
    }

    const currentSnapshotJson = JSON.stringify(captureStoreSnapshot(store));
    if (currentSnapshotJson !== globalStore.__ojpStoreLastPersistedSnapshotJson) {
      return;
    }

    void refreshStoreFromDbNow();
  }, STORE_REFRESH_INTERVAL_MS);
  interval.unref?.();
}

function defaultSubmissionRuntimeSummary(submission: Submission): SubmissionRuntimeSummary {
  return {
    status: submission.status,
    score: submission.score,
    totalTimeMs: submission.totalTimeMs,
    peakMemoryKb: submission.peakMemoryKb,
    judgeStartedAt: submission.judgeStartedAt,
    judgedAt: submission.judgedAt,
    judgeEnvironmentVersion: submission.judgeEnvironmentVersion,
  };
}

function getSubmissionRuntimeCache(): Record<string, SubmissionRuntimeSummary> {
  if (!globalStore.__ojpSubmissionRuntimeCache) {
    globalStore.__ojpSubmissionRuntimeCache = {};
  }
  return globalStore.__ojpSubmissionRuntimeCache;
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021" &&
    typeof error.meta?.table === "string" &&
    error.meta.table.includes(tableName)
  );
}

function applySubmissionRuntimeSummary(
  submission: Submission,
  summary?: SubmissionRuntimeSummary,
): Submission {
  const resolved = summary ?? getSubmissionRuntimeCache()[submission.id];
  if (!resolved) {
    return submission;
  }
  return {
    ...submission,
    status: resolved.status,
    score: resolved.score,
    totalTimeMs: resolved.totalTimeMs,
    peakMemoryKb: resolved.peakMemoryKb,
    judgeStartedAt: resolved.judgeStartedAt,
    judgedAt: resolved.judgedAt,
    judgeEnvironmentVersion: resolved.judgeEnvironmentVersion,
  };
}

async function refreshSubmissionRuntimeCacheNow(): Promise<void> {
  if (!STORE_DB_SYNC_ENABLED) {
    return;
  }
  try {
    const rows = await prisma.submissionRuntimeState.findMany();
    const nextCache: Record<string, SubmissionRuntimeSummary> = {};
    for (const row of rows) {
      nextCache[row.submissionId] = {
        status: normalizeSubmissionStatus(row.status) ?? "internal_error",
        score: row.score,
        totalTimeMs: row.totalTimeMs,
        peakMemoryKb: row.peakMemoryKb,
        judgeStartedAt: row.judgeStartedAt?.toISOString() ?? null,
        judgedAt: row.judgedAt?.toISOString() ?? null,
        judgeEnvironmentVersion: row.judgeEnvironmentVersion,
      };
    }
    globalStore.__ojpSubmissionRuntimeCache = nextCache;
  } catch (error) {
    if (isMissingTableError(error, "SubmissionRuntimeState")) {
      return;
    }
    throw error;
  }
}

function maybeRefreshSubmissionRuntimeCache(): void {
  if (!STORE_DB_SYNC_ENABLED) {
    return;
  }
  if (globalStore.__ojpSubmissionRuntimeCacheRefreshInFlight) {
    return;
  }
  const lastRefreshAt = globalStore.__ojpSubmissionRuntimeCacheLastRefreshAt ?? 0;
  if (Date.now() - lastRefreshAt < STORE_REFRESH_INTERVAL_MS) {
    return;
  }
  globalStore.__ojpSubmissionRuntimeCacheRefreshInFlight = true;
  void refreshSubmissionRuntimeCacheNow()
    .catch(() => {
      // noop
    })
    .finally(() => {
      globalStore.__ojpSubmissionRuntimeCacheRefreshInFlight = false;
      globalStore.__ojpSubmissionRuntimeCacheLastRefreshAt = Date.now();
    });
}

async function upsertSubmissionRuntimeState(input: {
  submissionId: string;
  status: SubmissionStatus;
  score: number;
  totalTimeMs: number;
  peakMemoryKb: number;
  judgeStartedAt: string | null;
  judgedAt: string | null;
  judgeEnvironmentVersion: string | null;
}): Promise<void> {
  await prisma.submissionRuntimeState.upsert({
    where: { submissionId: input.submissionId },
    update: {
      status: input.status,
      score: input.score,
      totalTimeMs: input.totalTimeMs,
      peakMemoryKb: input.peakMemoryKb,
      judgeStartedAt: input.judgeStartedAt ? new Date(input.judgeStartedAt) : null,
      judgedAt: input.judgedAt ? new Date(input.judgedAt) : null,
      judgeEnvironmentVersion: input.judgeEnvironmentVersion,
    },
    create: {
      submissionId: input.submissionId,
      status: input.status,
      score: input.score,
      totalTimeMs: input.totalTimeMs,
      peakMemoryKb: input.peakMemoryKb,
      judgeStartedAt: input.judgeStartedAt ? new Date(input.judgeStartedAt) : null,
      judgedAt: input.judgedAt ? new Date(input.judgedAt) : null,
      judgeEnvironmentVersion: input.judgeEnvironmentVersion,
    },
  });
  getSubmissionRuntimeCache()[input.submissionId] = {
    status: input.status,
    score: input.score,
    totalTimeMs: input.totalTimeMs,
    peakMemoryKb: input.peakMemoryKb,
    judgeStartedAt: input.judgeStartedAt,
    judgedAt: input.judgedAt,
    judgeEnvironmentVersion: input.judgeEnvironmentVersion,
  };
}

async function getSubmissionRuntimeState(
  submissionId: string,
): Promise<SubmissionRuntimeSummary | null> {
  const cached = getSubmissionRuntimeCache()[submissionId];
  if (cached) {
    return cached;
  }
  let row;
  try {
    row = await prisma.submissionRuntimeState.findUnique({
      where: { submissionId },
    });
  } catch (error) {
    if (isMissingTableError(error, "SubmissionRuntimeState")) {
      return null;
    }
    throw error;
  }
  if (!row) {
    return null;
  }
  const summary: SubmissionRuntimeSummary = {
    status: normalizeSubmissionStatus(row.status) ?? "internal_error",
    score: row.score,
    totalTimeMs: row.totalTimeMs,
    peakMemoryKb: row.peakMemoryKb,
    judgeStartedAt: row.judgeStartedAt?.toISOString() ?? null,
    judgedAt: row.judgedAt?.toISOString() ?? null,
    judgeEnvironmentVersion: row.judgeEnvironmentVersion,
  };
  getSubmissionRuntimeCache()[submissionId] = summary;
  return summary;
}

async function replaceSubmissionRuntimeTestResults(
  submissionId: string,
  results: Submission["testResults"],
): Promise<void> {
  const canonicalResults: Submission["testResults"] = [];
  const seenKeys = new Set<string>();
  for (const result of results) {
    const key = `${result.groupName}::${result.testCaseName}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    canonicalResults.push(result);
  }
  await prisma.$transaction(async (tx) => {
    await tx.submissionRuntimeTestResult.deleteMany({
      where: { submissionId },
    });
    if (canonicalResults.length > 0) {
      await tx.submissionRuntimeTestResult.createMany({
        data: canonicalResults.map((result, index) => ({
          id: result.id,
          submissionId,
          orderIndex: index,
          groupName: result.groupName,
          testCaseName: result.testCaseName,
          verdict: result.verdict,
          timeMs: result.timeMs,
          memoryKb: result.memoryKb,
          message: result.message,
        })),
      });
    }
  });
}

async function appendSubmissionRuntimeTestResult(
  submissionId: string,
  result: Submission["testResults"][number],
  orderIndex: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.submissionRuntimeTestResult.deleteMany({
      where: {
        submissionId,
        OR: [
          { orderIndex },
          {
            groupName: result.groupName,
            testCaseName: result.testCaseName,
          },
        ],
      },
    });
    await tx.submissionRuntimeTestResult.create({
      data: {
        id: result.id,
        submissionId,
        orderIndex,
        groupName: result.groupName,
        testCaseName: result.testCaseName,
        verdict: result.verdict,
        timeMs: result.timeMs,
        memoryKb: result.memoryKb,
        message: result.message,
      },
    });
  });
}

async function listSubmissionRuntimeTestResults(
  submissionId: string,
): Promise<Submission["testResults"]> {
  try {
    const rows = await prisma.submissionRuntimeTestResult.findMany({
      where: { submissionId },
      orderBy: { orderIndex: "asc" },
    });
    const results: Submission["testResults"] = [];
    const seenKeys = new Set<string>();
    for (const row of rows) {
      const key = `${row.groupName}::${row.testCaseName}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      results.push({
        id: row.id,
        groupName: row.groupName,
        testCaseName: row.testCaseName,
        verdict: normalizeSubmissionStatus(row.verdict) ?? "internal_error",
        timeMs: row.timeMs,
        memoryKb: row.memoryKb,
        message: row.message,
      });
    }
    return results;
  } catch (error) {
    if (isMissingTableError(error, "SubmissionRuntimeTestResult")) {
      return [];
    }
    throw error;
  }
}

async function resetSubmissionRuntime(
  submissionId: string,
  input: {
    status: SubmissionStatus;
    judgeStartedAt: string | null;
    judgedAt: string | null;
    judgeEnvironmentVersion: string | null;
  },
): Promise<void> {
  await replaceSubmissionRuntimeTestResults(submissionId, []);
  await upsertSubmissionRuntimeState({
    submissionId,
    status: input.status,
    score: 0,
    totalTimeMs: 0,
    peakMemoryKb: 0,
    judgeStartedAt: input.judgeStartedAt,
    judgedAt: input.judgedAt,
    judgeEnvironmentVersion: input.judgeEnvironmentVersion,
  });
}

async function deleteSubmissionRuntimeState(submissionId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.submissionRuntimeTestResult.deleteMany({
      where: { submissionId },
    });
    await tx.submissionRuntimeState.deleteMany({
      where: { submissionId },
    });
  });
  delete getSubmissionRuntimeCache()[submissionId];
}

const store = globalStore.__ojpStore ?? createInitialStore();

if (!globalStore.__ojpStore) {
  globalStore.__ojpStore = store;
}
if (typeof globalStore.__ojpStoreDbHydrated !== "boolean") {
  globalStore.__ojpStoreDbHydrated = !STORE_DB_SYNC_ENABLED;
}

normalizeStoreInPlace(store);
startStorePersistenceLoop();
startStoreRefreshLoop();
if (STORE_DB_SYNC_ENABLED && !globalStore.__ojpStoreDbHydrationStarted) {
  globalStore.__ojpStoreDbHydrationStarted = true;
  void hydrateStoreFromDb();
}

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
  return `tr-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
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

function nextPackageJobId(): string {
  const id = `pj${store.counters.packageJob}`;
  store.counters.packageJob += 1;
  return id;
}

function toPackageJobRecord(row: {
  id: string;
  type: string;
  requestedBy: string;
  problemId: string | null;
  fileName: string;
  status: string;
  storageRef: Prisma.JsonValue;
  previousRef: Prisma.JsonValue | null;
  language: Language | null;
  sourceCode: string | null;
  timeLimitMs: number | null;
  memoryLimitMb: number | null;
  result: Prisma.JsonValue | null;
  claimedBy: string | null;
  claimedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  createdAt: Date;
}): PackageJobRecord {
  if (row.type === "apply") {
    return {
      id: row.id,
      type: "apply",
      requestedBy: row.requestedBy,
      status: row.status as PackageJobStatus,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      error: row.error,
      problemId: row.problemId ?? "",
      fileName: row.fileName,
      storageRef: row.storageRef as unknown as ProblemPackageStorageRef,
      previousRef: row.previousRef as ProblemPackageStorageRef | null,
      result: (row.result as { problemId: string } | null) ?? null,
    };
  }

  return {
    id: row.id,
    type: "preview",
    requestedBy: row.requestedBy,
    status: row.status as PackageJobStatus,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: row.error,
    problemId: row.problemId,
    fileName: row.fileName,
    storageRef: row.storageRef as unknown as ProblemPackageStorageRef,
    language: (row.language as Language | null) ?? "python",
    sourceCode: row.sourceCode ?? "",
    timeLimitMs: row.timeLimitMs ?? 0,
    memoryLimitMb: row.memoryLimitMb ?? 0,
    result: (row.result as PackageJobPreviewResult | null) ?? null,
  };
}

async function enqueueJudgeJobDb(
  submissionId: string,
  reason: JudgeJobReason,
): Promise<void> {
  await prisma.judgeJob.create({
    data: {
      id: nextJudgeJobId(),
      submissionId,
      reason,
      status: "queued",
    },
  });
}

async function claimNextJudgeJobDb(): Promise<{
  id: string;
  submissionId: string;
  reason: JudgeJobReason;
} | null> {
  const staleBefore = new Date(Date.now() - JOB_CLAIM_STALE_MS);
  const claimedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string; submissionId: string; reason: string }>
    >`
      WITH candidate AS (
        SELECT id
        FROM "JudgeJob"
        WHERE status = 'queued' OR (status = 'running' AND "claimedAt" < ${staleBefore})
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "JudgeJob" AS job
      SET
        status = 'running',
        "claimedBy" = ${WORKER_INSTANCE_ID},
        "claimedAt" = ${claimedAt},
        "startedAt" = COALESCE(job."startedAt", ${claimedAt})
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING job.id, job."submissionId", job.reason
    `;
    if (rows.length === 0) {
      return null;
    }
    return {
      id: rows[0].id,
      submissionId: rows[0].submissionId,
      reason: (rows[0].reason as JudgeJobReason) ?? "normal",
    };
  });
}

async function finishJudgeJobDb(input: {
  id: string;
  status: "completed" | "failed";
  error?: string | null;
}): Promise<void> {
  await prisma.judgeJob.update({
    where: { id: input.id },
    data: {
      status: input.status,
      error: input.error ?? null,
      finishedAt: new Date(),
    },
  });
}

async function heartbeatJudgeJobDb(id: string): Promise<void> {
  await prisma.judgeJob.updateMany({
    where: {
      id,
      status: "running",
      claimedBy: WORKER_INSTANCE_ID,
    },
    data: {
      claimedAt: new Date(),
    },
  });
}

async function listJudgeJobsDb(limit = 50): Promise<
  Array<{
    id: string;
    submissionId: string;
    queuedAt: string;
    reason: JudgeJobReason;
    requestedAt: string;
  }>
> {
  const jobs = await prisma.judgeJob.findMany({
    where: {
      status: {
        in: ["queued", "running"],
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: limit,
  });
  return jobs.map((job) => ({
    id: job.id,
    submissionId: job.submissionId,
    queuedAt: job.createdAt.toISOString(),
    requestedAt: job.createdAt.toISOString(),
    reason: (job.reason as JudgeJobReason) ?? "normal",
  }));
}

async function activeJudgeJobSubmissionIdsDb(): Promise<Set<string>> {
  const jobs = await prisma.judgeJob.findMany({
    where: {
      status: {
        in: ["queued", "running"],
      },
    },
    select: {
      submissionId: true,
    },
  });
  return new Set(jobs.map((job) => job.submissionId));
}

async function enqueueMissingJudgeJobsDb(): Promise<number> {
  const rows = await prisma.submissionRuntimeState.findMany({
    where: {
      status: {
        in: ["pending", "queued", "compiling", "running", "judging"],
      },
    },
    select: {
      submissionId: true,
      status: true,
    },
  });
  const activeIds = await activeJudgeJobSubmissionIdsDb();
  let requeued = 0;
  for (const row of rows) {
    const submissionId = row.submissionId;
    const waitingSubmission = findSubmissionByIdInternal(submissionId);
    if (!waitingSubmission) {
      await deleteSubmissionRuntimeState(submissionId);
      continue;
    }
    if (activeIds.has(submissionId)) {
      continue;
    }
    if (waitingSubmission?.status === "pending") {
      waitingSubmission.status = "queued";
    }
    await enqueueJudgeJobDb(submissionId, "normal");
    requeued += 1;
  }
  return requeued;
}

async function createPackageJobDb(input: {
  type: "apply" | "preview";
  requestedBy: string;
  problemId?: string | null;
  fileName: string;
  storageRef: ProblemPackageStorageRef;
  previousRef?: ProblemPackageStorageRef | null;
  language?: Language;
  sourceCode?: string;
  timeLimitMs?: number;
  memoryLimitMb?: number;
}): Promise<PackageJobRecord> {
  const row = await prisma.packageJob.create({
    data: {
      id: nextPackageJobId(),
      type: input.type,
      requestedBy: input.requestedBy,
      problemId: input.problemId ?? null,
      fileName: input.fileName,
      status: "queued",
      storageRef: input.storageRef as unknown as Prisma.InputJsonValue,
      previousRef: input.previousRef
        ? (input.previousRef as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      language: input.language,
      sourceCode: input.sourceCode ?? null,
      timeLimitMs: input.timeLimitMs ?? null,
      memoryLimitMb: input.memoryLimitMb ?? null,
      result: Prisma.DbNull,
      error: null,
    },
  });
  return toPackageJobRecord(row);
}

async function claimNextPackageJobDb(): Promise<PackageJobRecord | null> {
  const staleBefore = new Date(Date.now() - JOB_CLAIM_STALE_MS);
  const claimedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      WITH candidate AS (
        SELECT id
        FROM "PackageJob"
        WHERE status = 'queued' OR (status = 'running' AND "claimedAt" < ${staleBefore})
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "PackageJob" AS job
      SET
        status = 'running',
        "claimedBy" = ${WORKER_INSTANCE_ID},
        "claimedAt" = ${claimedAt},
        "startedAt" = COALESCE(job."startedAt", ${claimedAt})
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING job.id
    `;
    if (rows.length === 0) {
      return null;
    }
    const row = await tx.packageJob.findUnique({
      where: { id: rows[0].id },
    });
    return row ? toPackageJobRecord(row) : null;
  });
}

async function finishPackageJobDb(input: {
  id: string;
  status: "completed" | "failed";
  error?: string | null;
  result?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.packageJob.update({
    where: { id: input.id },
    data: {
      status: input.status,
      error: input.error ?? null,
      result: input.result ?? Prisma.DbNull,
      finishedAt: new Date(),
    },
  });
}

async function heartbeatPackageJobDb(id: string): Promise<void> {
  await prisma.packageJob.updateMany({
    where: {
      id,
      status: "running",
      claimedBy: WORKER_INSTANCE_ID,
    },
    data: {
      claimedAt: new Date(),
    },
  });
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
  if (requeued > 0) {
    void persistStoreSnapshotNow();
  }

  return requeued;
}

async function runJudgeForSubmission(submissionId: string, reason: JudgeJobReason): Promise<void> {
  const submission = findSubmissionByIdInternal(submissionId);
  if (!submission) {
    await deleteSubmissionRuntimeState(submissionId);
    return;
  }
  const currentRuntime = (await getSubmissionRuntimeState(submissionId)) ?? defaultSubmissionRuntimeSummary(submission);
  if (!isWaitingSubmissionStatus(currentRuntime.status)) {
    return;
  }

  const judgeStartedAt = currentRuntime.judgeStartedAt ?? nowIso();
  const judgeEnvironmentVersion = getJudgeEnvironmentVersion();
  await upsertSubmissionRuntimeState({
    submissionId,
    status: currentRuntime.status,
    score: currentRuntime.score,
    totalTimeMs: currentRuntime.totalTimeMs,
    peakMemoryKb: currentRuntime.peakMemoryKb,
    judgeStartedAt,
    judgedAt: null,
    judgeEnvironmentVersion,
  });

  const problem = getProblemById(submission.problemId);
  if (!problem) {
    const result = {
      id: nextTestResultId(),
      groupName: "system",
      testCaseName: "-",
      verdict: "internal_error" as SubmissionStatus,
      timeMs: 0,
      memoryKb: 0,
      message: "problem not found while judging",
    };
    await replaceSubmissionRuntimeTestResults(submissionId, [result]);
    await upsertSubmissionRuntimeState({
      submissionId,
      status: "internal_error",
      score: 0,
      totalTimeMs: 0,
      peakMemoryKb: 0,
      judgeStartedAt,
      judgedAt: nowIso(),
      judgeEnvironmentVersion,
    });
    appendAuditLog({
      actorId: submission.userId,
      action: "submission.judge",
      targetType: "submission",
      targetId: submission.id,
      reason,
      metadata: {
        result: "internal_error",
        score: "0",
      },
    });
    return;
  }

  const packageRef = store.problemPackageRefs[problem.id];
  const packageData = packageRef ? null : await loadProblemPackageData(problem.id);
  const packageSource =
    packageRef && isProblemPackageObjectStorageEnabled()
      ? await createLazyProblemPackageSourceFromStorageRef({
          ref: packageRef,
          fileName: problem.latestPackageSummary?.fileName ?? `${problem.slug}.zip`,
        })
      : null;
  const hasGroups =
    packageSource ? packageSource.groups.length > 0 : (packageData?.groups.length ?? 0) > 0;
  if (!hasGroups) {
    await packageSource?.cleanup();
    const result = {
      id: nextTestResultId(),
      groupName: "system",
      testCaseName: "-",
      verdict: "internal_error" as SubmissionStatus,
      timeMs: 0,
      memoryKb: 0,
      message: "problem package is not configured. upload ZIP package before judging",
    };
    await replaceSubmissionRuntimeTestResults(submissionId, [result]);
    await upsertSubmissionRuntimeState({
      submissionId,
      status: "internal_error",
      score: 0,
      totalTimeMs: 0,
      peakMemoryKb: 0,
      judgeStartedAt,
      judgedAt: nowIso(),
      judgeEnvironmentVersion,
    });
    appendAuditLog({
      actorId: submission.userId,
      action: "submission.judge",
      targetType: "submission",
      targetId: submission.id,
      reason,
      metadata: {
        result: "internal_error",
        score: "0",
      },
    });
    return;
  }

  try {
    let phase: SubmissionStatus = "compiling";
    const existingResults = await listSubmissionRuntimeTestResults(submissionId);
    const orderedCases = packageSource
      ? packageSource.groups.flatMap((group) =>
          group.caseNames.map((caseName) => ({
            groupName: group.name,
            testCaseName: caseName,
          })),
        )
      : (packageData?.groups ?? []).flatMap((group) =>
          group.tests.map((testCase) => ({
            groupName: group.name,
            testCaseName: testCase.name,
          })),
        );
    const canResume =
      existingResults.length > 0 &&
      existingResults.every((result, index) => {
        const expected = orderedCases[index];
        return (
          expected &&
          result.groupName === expected.groupName &&
          result.testCaseName === expected.testCaseName
        );
      });
    let orderIndex = canResume ? existingResults.length : 0;
    if (!canResume) {
      await replaceSubmissionRuntimeTestResults(submissionId, []);
    }
    await upsertSubmissionRuntimeState({
      submissionId,
      status: "compiling",
      score: 0,
      totalTimeMs: canResume
        ? existingResults.reduce((max, result) => Math.max(max, result.timeMs), 0)
        : 0,
      peakMemoryKb: canResume
        ? existingResults.reduce((max, result) => Math.max(max, result.memoryKb), 0)
        : 0,
      judgeStartedAt,
      judgedAt: null,
      judgeEnvironmentVersion,
    });

    const judged = await executePackageJudge({
      sourceCode: submission.sourceCode,
      language: submission.language,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      packageData: packageData ?? undefined,
      packageSource: packageSource ?? undefined,
      existingResults: canResume ? existingResults : [],
      nextTestResultId,
      onPhaseChange: async (nextPhase) => {
        phase = nextPhase;
        const current = (await getSubmissionRuntimeState(submissionId)) ?? defaultSubmissionRuntimeSummary(submission);
        await upsertSubmissionRuntimeState({
          submissionId,
          status: nextPhase,
          score: current.score,
          totalTimeMs: current.totalTimeMs,
          peakMemoryKb: current.peakMemoryKb,
          judgeStartedAt,
          judgedAt: null,
          judgeEnvironmentVersion,
        });
      },
      onTestResult: async ({ result, totalTimeMs, peakMemoryKb }) => {
        await appendSubmissionRuntimeTestResult(submissionId, result, orderIndex++);
        await upsertSubmissionRuntimeState({
          submissionId,
          status: phase,
          score: 0,
          totalTimeMs,
          peakMemoryKb,
          judgeStartedAt,
          judgedAt: null,
          judgeEnvironmentVersion,
        });
      },
    });
    if (orderIndex !== judged.testResults.length) {
      await replaceSubmissionRuntimeTestResults(submissionId, judged.testResults);
    }
    await upsertSubmissionRuntimeState({
      submissionId,
      status: judged.status,
      score: judged.score,
      totalTimeMs: judged.totalTimeMs,
      peakMemoryKb: judged.peakMemoryKb,
      judgeStartedAt,
      judgedAt: nowIso(),
      judgeEnvironmentVersion,
    });

    appendAuditLog({
      actorId: submission.userId,
      action: "submission.judge",
      targetType: "submission",
      targetId: submission.id,
      reason,
      metadata: {
        result: judged.status,
        score: String(judged.score),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "judge internal error";
    const result = {
      id: nextTestResultId(),
      groupName: "system",
      testCaseName: "-",
      verdict: "internal_error" as SubmissionStatus,
      timeMs: 0,
      memoryKb: 0,
      message,
    };
    await replaceSubmissionRuntimeTestResults(submissionId, [result]);
    await upsertSubmissionRuntimeState({
      submissionId,
      status: "internal_error",
      score: 0,
      totalTimeMs: 0,
      peakMemoryKb: 0,
      judgeStartedAt,
      judgedAt: nowIso(),
      judgeEnvironmentVersion,
    });
    appendAuditLog({
      actorId: submission.userId,
      action: "submission.judge",
      targetType: "submission",
      targetId: submission.id,
      reason,
      metadata: {
        result: "internal_error",
        score: "0",
      },
    });
  } finally {
    await packageSource?.cleanup();
  }
}

function scheduleJudgeWorker(): void {
  if (!canExecuteJudgeJobsInThisProcess()) {
    return;
  }
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
      void persistStoreSnapshotNow();
      await runJudgeForSubmission(nextJob.submissionId, nextJob.reason);
    } finally {
      store.judgeInFlightSubmissionIds = store.judgeInFlightSubmissionIds.filter(
        (submissionId) => submissionId !== nextJob.submissionId,
      );
      void persistStoreSnapshotNow();
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
  oauthProvider?: string;
  oauthAccountId?: string;
  oauthLogin?: string;
  oauthBio?: string | null;
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

function oauthAccountKey(provider: string, accountId: string): string {
  return `${provider}:${accountId}`;
}

function upsertUserFromOAuthSession(params: {
  provider: string;
  accountId?: string;
  login: string;
  name?: string | null;
  bio?: string | null;
}): { user: User; changed: boolean } {
  const normalizedProvider = normalizeUsername(params.provider);
  const normalizedLogin = normalizeUsername(params.login);
  const accountId = params.accountId?.trim() ?? "";
  const accountKey = accountId ? oauthAccountKey(normalizedProvider, accountId) : "";
  const legacyGitHubAccountKey =
    normalizedProvider === "github" && accountId ? accountId : "";
  const shouldGrantAdmin =
    normalizedProvider === "github"
      ? shouldGrantAdminFromGitHub({
          githubLogin: normalizedLogin,
          githubId: accountId,
        })
      : false;
  const timestamp = nowIso();
  let changed = false;

  let user: User | undefined;
  if (accountKey) {
    const indexedUserId =
      store.githubIndex[accountKey] ||
      (legacyGitHubAccountKey ? store.githubIndex[legacyGitHubAccountKey] : undefined);
    if (indexedUserId) {
      user = findUser(indexedUserId);
      if (!user) {
        delete store.githubIndex[accountKey];
        if (legacyGitHubAccountKey) {
          delete store.githubIndex[legacyGitHubAccountKey];
        }
      }
    }
  }

  if (!user && normalizedProvider === "github") {
    user = findActiveUserByUsername(normalizedLogin);
  }

  if (!user) {
    const displayNameBase = params.name?.trim() || normalizedLogin;
    user = {
      id: nextUserId(),
      username: uniqueUsername(normalizedLogin),
      displayName: uniqueDisplayName(displayNameBase),
      bio: params.bio?.trim() ?? "",
      role: shouldGrantAdmin ? "admin" : "user",
      status: "active",
      displayNameChangedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.users.push(user);
    changed = true;
  }

  if (user.status === "deleted") {
    throw new HttpError("user account is deleted", 403);
  }

  const nextUsername = uniqueUsername(normalizedLogin, user.id);
  if (nextUsername !== user.username) {
    user.username = nextUsername;
    changed = true;
  }

  if ((!user.bio || !user.bio.trim()) && params.bio && params.bio.trim()) {
    user.bio = params.bio.trim();
    changed = true;
  }

  if (shouldGrantAdmin && user.role !== "admin") {
    const previousRole = user.role;
    user.role = "admin";
    appendAuditLog({
      actorId: user.id,
      action: "admin.user.role.update",
      targetType: "user",
      targetId: user.id,
      reason: "github admin bootstrap",
      metadata: {
        previousRole,
        nextRole: "admin",
      },
    });
    changed = true;
  }

  if (accountKey) {
    if (store.githubIndex[accountKey] !== user.id) {
      changed = true;
    }
    store.githubIndex[accountKey] = user.id;
  }
  if (changed && user.updatedAt !== timestamp) {
    user.updatedAt = timestamp;
  }

  return { user, changed };
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

  const provider =
    sessionUser.oauthProvider ||
    (sessionUser.githubLogin || sessionUser.githubId ? "github" : undefined);
  const login =
    sessionUser.oauthLogin ||
    sessionUser.githubLogin ||
    (typeof sessionUser.name === "string" ? sessionUser.name : undefined);
  if (!provider || !login) {
    throw new HttpError("oauth profile is missing required fields", 401);
  }

  const result = upsertUserFromOAuthSession({
    provider,
    accountId: sessionUser.oauthAccountId ?? sessionUser.githubId,
    login,
    name: sessionUser.name,
    bio: sessionUser.oauthBio ?? sessionUser.githubBio,
  });
  if (result.changed) {
    await persistStoreSnapshotNow();
  }

  return result.user;
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

export async function getProblemPackageCaseManifest(
  problemId: string,
): Promise<ProblemPackageCaseManifest | null> {
  const ref = store.problemPackageRefs[problemId];
  if (ref && isProblemPackageObjectStorageEnabled()) {
    const source = await createLazyProblemPackageSourceFromStorageRef({
      ref,
      fileName: store.problems.find((problem) => problem.id === problemId)?.latestPackageSummary?.fileName ?? `${problemId}.zip`,
    });
    try {
      return {
        groups: source.groups.map((group) => ({
          name: group.name,
          caseNames: group.caseNames,
        })),
      };
    } finally {
      await source.cleanup();
    }
  }

  const packageData = await loadProblemPackageData(problemId);
  if (!packageData) {
    return null;
  }
  return {
    groups: packageData.groups.map((group) => ({
      name: group.name,
      caseNames: group.tests.map((testCase) => testCase.name),
    })),
  };
}

async function loadProblemPackageData(problemId: string): Promise<ProblemPackageExtracted | undefined> {
  const cached = store.problemPackages[problemId];
  if (cached) {
    return cached;
  }

  const ref = store.problemPackageRefs[problemId];
  if (!ref) {
    return undefined;
  }

  const zipBuffer = await getProblemPackageZip(ref);
  const storedFileName = ref.key.split("/").pop() ?? `${problemId}.zip`;
  const fileName = storedFileName.toLowerCase().endsWith(".zip")
    ? storedFileName
    : `${storedFileName}.zip`;
  const extracted = validateProblemPackageCached(fileName, zipBuffer);
  rememberProblemPackageData(problemId, extracted);
  return extracted;
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

export async function getProblemPackageData(
  problemId: string,
): Promise<ProblemPackageExtracted | undefined> {
  return loadProblemPackageData(problemId);
}

export function getProblemPackageStorageRef(
  problemId: string,
): ProblemPackageStorageRef | undefined {
  return store.problemPackageRefs[problemId];
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
    difficulty: input.difficulty,
    timeLimitMs: input.timeLimitMs,
    memoryLimitMb: input.memoryLimitMb,
    scoringType: "sum",
    testCaseVisibility: input.testCaseVisibility,
    latestPackageSummary: null,
    sampleCases: [],
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
  if ("difficulty" in input) {
    if (input.difficulty === null) {
      problem.difficulty = null;
    } else if (typeof input.difficulty === "number" && Number.isFinite(input.difficulty)) {
      problem.difficulty = Math.trunc(input.difficulty);
    }
  }
  if (typeof input.timeLimitMs === "number" && input.timeLimitMs > 0) {
    problem.timeLimitMs = input.timeLimitMs;
  }
  if (typeof input.memoryLimitMb === "number" && input.memoryLimitMb > 0) {
    problem.memoryLimitMb = input.memoryLimitMb;
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
  storageRef?: ProblemPackageStorageRef | null,
): Promise<Problem> {
  const actor = await getCurrentUser();
  const problem = resolveProblemIfExists(problemId);
  if (actor.role !== "admin" && problem.authorId !== actor.id) {
    throw new HttpError("you cannot upload package for this problem", 403);
  }

  return applyProblemPackageExtractedInternal(problem, packageData, storageRef ?? null);
}

async function applyProblemPackageExtractedInternal(
  problem: Problem,
  packageData: ProblemPackageExtracted,
  storageRef: ProblemPackageStorageRef | null,
): Promise<Problem> {
  problem.timeLimitMs = packageData.validation.config.timeLimitMs;
  problem.memoryLimitMb = packageData.validation.config.memoryLimitMb;
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
  problem.sampleCases = packageData.samples.map((sample) => ({
    name: sample.name,
    description: sample.description,
    input: sample.input,
    output: sample.output,
  }));
  const previousRef = store.problemPackageRefs[problem.id];
  rememberProblemPackageData(problem.id, packageData);
  if (storageRef) {
    store.problemPackageRefs[problem.id] = storageRef;
    if (previousRef && previousRef.key !== storageRef.key) {
      await deleteProblemPackageZip(previousRef);
    }
  }
  problem.updatedAt = nowIso();
  await persistStoreSnapshotNow();

  return problem;
}

async function applyProblemPackageManifestInternal(
  problem: Problem,
  manifest: ProblemPackageManifest,
  storageRef: ProblemPackageStorageRef | null,
  previousRef: ProblemPackageStorageRef | null,
): Promise<Problem> {
  problem.timeLimitMs = manifest.validation.config.timeLimitMs;
  problem.memoryLimitMb = manifest.validation.config.memoryLimitMb;
  problem.scoringType =
    manifest.scoringType === "sum_of_groups" ? "sum_of_groups" : manifest.scoringType;
  problem.latestPackageSummary = {
    fileName: manifest.validation.fileName,
    zipSizeBytes: manifest.validation.zipSizeBytes,
    fileCount: manifest.validation.fileCount,
    samplePairs: manifest.validation.samplePairs,
    testGroupCount: manifest.validation.testGroupCount,
    totalTestPairs: manifest.validation.totalTestPairs,
    warnings: manifest.validation.warnings,
    validatedAt: nowIso(),
  };
  problem.sampleCases = manifest.sampleCases.map((sample) => ({
    name: sample.name,
    description: sample.description,
    input: sample.input,
    output: sample.output,
  }));
  forgetProblemPackageData(problem.id);
  if (storageRef) {
    store.problemPackageRefs[problem.id] = storageRef;
    if (previousRef && previousRef.key !== storageRef.key) {
      await deleteProblemPackageZip(previousRef);
    }
  }
  problem.updatedAt = nowIso();
  await persistStoreSnapshotNow();
  return problem;
}

async function runPackageJobInternal(job: PackageJobRecord): Promise<void> {
  try {
    const packageSource = await createLazyProblemPackageSourceFromStorageRef({
      ref: job.storageRef,
      fileName: job.fileName,
    });

    try {
      if (job.type === "apply") {
        const manifest = packageSource.manifest;
        while (!(await tryAcquireOrRenewLease(APP_STATE_WRITE_LEASE_ID))) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        try {
          await refreshStoreFromDbNow();
          const problem = resolveProblemIfExists(job.problemId);
          await applyProblemPackageManifestInternal(
            problem,
            manifest,
            job.storageRef,
            job.previousRef,
          );
        } finally {
          await releaseLease(APP_STATE_WRITE_LEASE_ID);
        }
        job.result = {
          problemId: job.problemId,
        };
        await finishPackageJobDb({
          id: job.id,
          status: "completed",
          result: {
            problemId: job.problemId,
          },
        });
      } else {
        let testResultCounter = 0;
        const result = await executePackageJudge({
          sourceCode: job.sourceCode,
          language: job.language,
          timeLimitMs: job.timeLimitMs,
          memoryLimitMb: job.memoryLimitMb,
          packageSource,
          nextTestResultId: () => `preview-test-result-${++testResultCounter}`,
        });
        job.result = result;
        await finishPackageJobDb({
          id: job.id,
          status: "completed",
          result: result as unknown as Prisma.InputJsonValue,
        });
      }
    } finally {
      await packageSource.cleanup();
    }
  } catch (error) {
    await finishPackageJobDb({
      id: job.id,
      status: "failed",
      error: error instanceof Error ? error.message : "package job failed",
    });
    if (job.type === "apply") {
      const currentRef = store.problemPackageRefs[job.problemId];
      if (!currentRef || currentRef.key !== job.storageRef.key) {
        try {
          await deleteProblemPackageZip(job.storageRef);
        } catch {
          // noop
        }
      }
    }
  } finally {
    if (job.type === "preview") {
      try {
        await deleteProblemPackageZip(job.storageRef);
      } catch {
        // noop
      }
    }
  }
}

export async function createProblemPackageApplyJob(input: {
  problemId: string;
  fileName: string;
  storageRef: ProblemPackageStorageRef;
}): Promise<PackageJobRecord> {
  const actor = await getCurrentUser();
  const problem = resolveProblemIfExists(input.problemId);
  if (actor.role !== "admin" && problem.authorId !== actor.id) {
    throw new HttpError("you cannot upload package for this problem", 403);
  }
  const job = await createPackageJobDb({
    type: "apply",
    requestedBy: actor.id,
    problemId: problem.id,
    fileName: input.fileName,
    storageRef: input.storageRef,
    previousRef: store.problemPackageRefs[problem.id] ?? null,
  });
  if (JUDGE_PROCESS_MODE === "inline") {
    await runPackageJobInternal(job);
    const row = await prisma.packageJob.findUnique({ where: { id: job.id } });
    return row ? toPackageJobRecord(row) : job;
  }
  return job;
}

export async function createProblemPackagePreviewJob(input: {
  problemId?: string | null;
  fileName: string;
  storageRef: ProblemPackageStorageRef;
  sourceCode: string;
  language: Language;
  timeLimitMs: number;
  memoryLimitMb: number;
}): Promise<PackageJobRecord> {
  const actor = await getCurrentUser();
  assertActiveUser(actor);
  if (!canCreateProblemByRole(actor.role)) {
    throw new HttpError("problem creation requires problem_author role", 403);
  }
  const job = await createPackageJobDb({
    type: "preview",
    requestedBy: actor.id,
    problemId: input.problemId ?? null,
    fileName: input.fileName,
    storageRef: input.storageRef,
    language: input.language,
    sourceCode: input.sourceCode,
    timeLimitMs: input.timeLimitMs,
    memoryLimitMb: input.memoryLimitMb,
  });
  if (JUDGE_PROCESS_MODE === "inline") {
    await runPackageJobInternal(job);
    const row = await prisma.packageJob.findUnique({ where: { id: job.id } });
    return row ? toPackageJobRecord(row) : job;
  }
  return job;
}

export async function getPackageJobForViewer(jobId: string): Promise<PackageJobRecord> {
  const actor = await getCurrentUser();
  const row = await prisma.packageJob.findUnique({
    where: { id: jobId },
  });
  const job = row ? toPackageJobRecord(row) : null;
  if (!job) {
    throw new HttpError("package job not found", 404);
  }
  if (actor.role !== "admin" && job.requestedBy !== actor.id) {
    throw new HttpError("you cannot access this package job", 403);
  }
  if (JUDGE_PROCESS_MODE === "web" && job.type === "apply" && job.status === "completed") {
    await refreshStoreFromDbNow();
  }
  return job;
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
  maybeRefreshSubmissionRuntimeCache();
  const filtered = [...store.submissions]
    .map((submission) => applySubmissionRuntimeSummary(submission))
    .filter((submission) => {
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
  maybeRefreshSubmissionRuntimeCache();
  return [...store.submissions]
    .map((submission) => applySubmissionRuntimeSummary(submission))
    .sort(
      (left, right) =>
        new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
    )
    .slice(0, limit);
}

export function getSubmissionById(submissionId: string): Submission | undefined {
  maybeRefreshSubmissionRuntimeCache();
  const submission = findSubmissionByIdInternal(submissionId);
  return submission ? applySubmissionRuntimeSummary(submission) : undefined;
}

export async function createSubmission(input: CreateSubmissionInput): Promise<Submission> {
  const currentUser = await getCurrentUser();
  assertActiveUser(currentUser);

  const problem = resolveProblemIfExists(input.problemId);

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
  if (JUDGE_PROCESS_MODE === "inline") {
    enqueueJudgeJob(submission.id, "normal");
  } else {
    await enqueueJudgeJobDb(submission.id, "normal");
  }
  await upsertSubmissionRuntimeState({
    submissionId: submission.id,
    status: "queued",
    score: 0,
    totalTimeMs: 0,
    peakMemoryKb: 0,
    judgeStartedAt: null,
    judgedAt: null,
    judgeEnvironmentVersion: null,
  });
  await persistStoreSnapshotNow();
  return applySubmissionRuntimeSummary(submission, getSubmissionRuntimeCache()[submission.id]);
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
  const inContestSubmissions = store.submissions
    .map((submission) => applySubmissionRuntimeSummary(submission))
    .filter(
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
  problemPackages: Record<string, ProblemPackageExtracted>;
  problemPackageRefs: Record<string, ProblemPackageStorageRef>;
  contests: Contest[];
  submissions: Submission[];
  announcements: Announcement[];
  reports: Report[];
  auditLogs: AuditLog[];
  rejudgeRequests: RejudgeRequest[];
  githubIndex: Record<string, string>;
  counters: Store["counters"];
  rateLimits: RateLimits;
} {
  return captureStoreSnapshot(store);
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

export async function getSubmissionWithAccess(
  submissionId: string,
  viewerId: string,
): Promise<{ submission: Submission; canViewSource: boolean } | undefined> {
  const baseSubmission = getSubmissionById(submissionId);
  if (!baseSubmission) {
    return undefined;
  }

  const runtimeSummary = await getSubmissionRuntimeState(submissionId);
  const runtimeResults = await listSubmissionRuntimeTestResults(submissionId);
  const submission = applySubmissionRuntimeSummary(
    {
      ...baseSubmission,
      testResults: runtimeResults.length > 0 ? runtimeResults : baseSubmission.testResults,
    },
    runtimeSummary ?? undefined,
  );
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

function removeQueuedStateForSubmissionIds(submissionIds: ReadonlySet<string>): void {
  store.judgeQueue = store.judgeQueue.filter((job) => !submissionIds.has(job.submissionId));
  store.judgeInFlightSubmissionIds = store.judgeInFlightSubmissionIds.filter(
    (submissionId) => !submissionIds.has(submissionId),
  );
}

export async function deleteProblemByAdmin(
  problemId: string,
  reason: string,
): Promise<Problem> {
  const admin = await getCurrentUser();
  assertAdmin(admin);
  const problem = resolveProblemIfExists(problemId);

  const deletedSubmissionIds = new Set(
    store.submissions
      .filter((submission) => submission.problemId === problemId)
      .map((submission) => submission.id),
  );

  store.problems = store.problems.filter((item) => item.id !== problemId);
  const packageRef = store.problemPackageRefs[problemId];
  forgetProblemPackageData(problemId);
  delete store.problemPackageRefs[problemId];
  store.contests = store.contests.map((contest) => ({
    ...contest,
    problems: contest.problems
      .filter((contestProblem) => contestProblem.problemId !== problemId)
      .map((contestProblem, index) => ({
        ...contestProblem,
        orderIndex: index,
      })),
  }));
  store.submissions = store.submissions.filter((submission) => submission.problemId !== problemId);
  store.rejudgeRequests = store.rejudgeRequests.filter(
    (request) =>
      request.problemId !== problemId && !deletedSubmissionIds.has(request.submissionId),
  );
  store.reports = store.reports.filter((report) => {
    if (report.targetType === "problem" && report.targetId === problemId) {
      return false;
    }
    if (report.targetType === "submission" && deletedSubmissionIds.has(report.targetId)) {
      return false;
    }
    return true;
  });
  removeQueuedStateForSubmissionIds(deletedSubmissionIds);
  if (packageRef) {
    await deleteProblemPackageZip(packageRef);
  }

  appendAuditLog({
    actorId: admin.id,
    action: "admin.problem.delete",
    targetType: "problem",
    targetId: problem.id,
    reason: reason || "problem deleted by admin",
  });

  return problem;
}

export async function deleteContestByAdmin(
  contestId: string,
  reason: string,
): Promise<Contest> {
  const admin = await getCurrentUser();
  assertAdmin(admin);
  const contest = resolveContestIfExists(contestId);

  store.contests = store.contests.filter((item) => item.id !== contestId);
  for (const submission of store.submissions) {
    if (submission.contestId === contestId) {
      submission.contestId = null;
    }
  }
  store.reports = store.reports.filter(
    (report) => !(report.targetType === "contest" && report.targetId === contestId),
  );

  appendAuditLog({
    actorId: admin.id,
    action: "admin.contest.delete",
    targetType: "contest",
    targetId: contest.id,
    reason: reason || "contest deleted by admin",
  });

  return contest;
}

export async function migrateProblemPackagesToObjectStorageByAdmin(): Promise<{
  migrated: number;
  skipped: number;
}> {
  const admin = await getCurrentUser();
  assertAdmin(admin);
  if (!isProblemPackageObjectStorageEnabled()) {
    throw new HttpError("R2 is not configured", 400);
  }

  let migrated = 0;
  let skipped = 0;

  for (const problem of store.problems) {
    if (store.problemPackageRefs[problem.id]) {
      skipped += 1;
      continue;
    }
    const packageData = store.problemPackages[problem.id];
    if (!packageData) {
      skipped += 1;
      continue;
    }

    const zipBuffer = buildProblemPackageZip({
      title: problem.title,
      slug: problem.slug,
      visibility: problem.visibility,
      explanationVisibility: problem.explanationVisibility,
      difficulty: problem.difficulty,
      testCaseVisibility: problem.testCaseVisibility,
      statementMarkdown: problem.statementMarkdown,
      inputDescription: problem.inputDescription,
      outputDescription: problem.outputDescription,
      constraintsMarkdown: problem.constraintsMarkdown,
      explanationMarkdown: problem.explanationMarkdown,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      draft: buildEditorDraftFromExtracted(packageData),
    });

    const storageRef = await putProblemPackageZip({
      problemId: problem.id,
      fileName: packageData.validation.fileName,
      zipBuffer,
    });

    store.problemPackageRefs[problem.id] = storageRef;
    migrated += 1;
  }

  await persistStoreSnapshotNow();
  return { migrated, skipped };
}

export async function getJudgeQueueStatsForAdmin(): Promise<{
  queuedJobs: number;
  waitingSubmissions: number;
  running: boolean;
}> {
  const user = await getCurrentUser();
  assertAdmin(user);
  const [queuedJobs, runningJobs] = await Promise.all([
    prisma.judgeJob.count({
      where: {
        status: {
          in: ["queued", "running"],
        },
      },
    }),
    prisma.judgeJob.count({
      where: {
        status: "running",
      },
    }),
  ]);
  return {
    queuedJobs,
    waitingSubmissions: collectWaitingSubmissionIds().length,
    running: runningJobs > 0,
  };
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
  const jobs = await listJudgeJobsDb(limit);
  const activeIds = await activeJudgeJobSubmissionIdsDb();
  const waitingSubmissionIds = collectWaitingSubmissionIds();
  const runningJobs = await prisma.judgeJob.count({
    where: {
      status: "running",
    },
  });
  return {
    stats: {
      queuedJobs: activeIds.size,
      waitingSubmissions: waitingSubmissionIds.length,
      running: runningJobs > 0,
    },
    jobs,
    orphanWaitingSubmissionIds: waitingSubmissionIds.filter((submissionId) => !activeIds.has(submissionId)),
  };
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
  const requeued = await enqueueMissingJudgeJobsDb();
  return {
    requeued,
    diagnostics: await getJudgeQueueDiagnosticsForAdmin(),
  };
}

async function tryAcquireOrRenewLease(leaseId: string): Promise<boolean> {
  if (!STORE_DB_SYNC_ENABLED) {
    return true;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + WORKER_LEASE_DURATION_MS);
  const updated = await prisma.workerLease.updateMany({
    where: {
      id: leaseId,
      OR: [
        { ownerId: WORKER_INSTANCE_ID },
        { expiresAt: { lt: now } },
      ],
    },
    data: {
      ownerId: WORKER_INSTANCE_ID,
      expiresAt,
    },
  });
  if (updated.count > 0) {
    return true;
  }

  try {
    await prisma.workerLease.create({
      data: {
        id: leaseId,
        ownerId: WORKER_INSTANCE_ID,
        expiresAt,
      },
    });
    return true;
  } catch {
    return false;
  }
}

async function releaseLease(leaseId: string): Promise<void> {
  if (!STORE_DB_SYNC_ENABLED) {
    return;
  }
  await prisma.workerLease.updateMany({
    where: {
      id: leaseId,
      ownerId: WORKER_INSTANCE_ID,
    },
    data: {
      expiresAt: new Date(0),
    },
  });
}

export function getJudgeProcessMode(): "inline" | "web" | "worker" {
  return JUDGE_PROCESS_MODE;
}

export async function startDedicatedJudgeWorkerLoop(): Promise<void> {
  if (JUDGE_PROCESS_MODE !== "worker") {
    return;
  }
  if (globalStore.__ojpDedicatedJudgeLoopStarted) {
    return;
  }

  globalStore.__ojpDedicatedJudgeLoopStarted = true;

  const tick = async () => {
    if (store.judgeWorkerRunning || store.packageJobWorkerRunning) {
      return;
    }
    await refreshStoreFromDbNow();
    const requeued = await enqueueMissingJudgeJobsDb();
    if (requeued > 0 && JUDGE_PROCESS_MODE !== "worker") {
      await persistStoreSnapshotNow();
    }
    const packageJob = await claimNextPackageJobDb();
    if (packageJob) {
      store.packageJobWorkerRunning = true;
      const heartbeat = setInterval(() => {
        void heartbeatPackageJobDb(packageJob.id);
      }, JOB_HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();
      try {
        await runPackageJobInternal(packageJob);
      } finally {
        clearInterval(heartbeat);
        store.packageJobWorkerRunning = false;
      }
      return;
    }

    const judgeJob = await claimNextJudgeJobDb();
    if (judgeJob) {
      store.judgeWorkerRunning = true;
      const heartbeat = setInterval(() => {
        void heartbeatJudgeJobDb(judgeJob.id);
      }, JOB_HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();
      try {
        await runJudgeForSubmission(judgeJob.submissionId, judgeJob.reason);
        await finishJudgeJobDb({
          id: judgeJob.id,
          status: "completed",
        });
      } catch (error) {
        await finishJudgeJobDb({
          id: judgeJob.id,
          status: "failed",
          error: error instanceof Error ? error.message : "judge job failed",
        });
      } finally {
        clearInterval(heartbeat);
        store.judgeWorkerRunning = false;
      }
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, DEDICATED_JUDGE_POLL_INTERVAL_MS);
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

  if (JUDGE_PROCESS_MODE === "inline") {
    enqueueJudgeJob(submission.id, "rejudge");
  } else {
    await enqueueJudgeJobDb(submission.id, "rejudge");
  }
  await resetSubmissionRuntime(submission.id, {
    status: "queued",
    judgeStartedAt: null,
    judgedAt: null,
    judgeEnvironmentVersion: null,
  });
  await persistStoreSnapshotNow();

  return {
    request,
    submission: applySubmissionRuntimeSummary(submission, getSubmissionRuntimeCache()[submission.id]),
  };
}

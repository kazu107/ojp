import {
  AuditAction,
  AuditLog,
  Contest,
  ContestProblem,
  ContestStatus,
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
  Visibility,
} from "@/lib/types";

const CURRENT_USER_ID = "u1";
const BASE_LANGUAGES: Language[] = ["cpp", "python", "java", "javascript"];

const SUBMISSION_COOLDOWN_MS = 10_000;
const SUBMISSION_LIMIT_WINDOW_MS = 60_000;
const SUBMISSION_LIMIT_PER_WINDOW = 20;

const REJUDGE_COOLDOWN_MS = 60_000;
const REJUDGE_LIMIT_WINDOW_MS = 60_000;
const REJUDGE_LIMIT_PER_WINDOW = 3;

const DISPLAY_NAME_CHANGE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

interface RateLimits {
  submissionByUserWindow: Record<string, number[]>;
  submissionCooldownByProblem: Record<string, number>;
  rejudgeByUserWindow: Record<string, number[]>;
  rejudgeCooldownByProblem: Record<string, number>;
}

interface Store {
  users: User[];
  problems: Problem[];
  contests: Contest[];
  submissions: Submission[];
  reports: Report[];
  auditLogs: AuditLog[];
  rejudgeRequests: RejudgeRequest[];
  counters: {
    problem: number;
    contest: number;
    submission: number;
    testResult: number;
    report: number;
    audit: number;
    rejudge: number;
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
      visibility: "public",
      timeLimitMs: 2000,
      memoryLimitMb: 512,
      supportedLanguages: BASE_LANGUAGES,
      scoringType: "sum",
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
      visibility: "public",
      timeLimitMs: 2000,
      memoryLimitMb: 512,
      supportedLanguages: BASE_LANGUAGES,
      scoringType: "sum",
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
      status: "AC",
      score: 100,
      totalTimeMs: 12,
      peakMemoryKb: 2200,
      submittedAt: "2026-02-24T12:05:00.000Z",
      judgedAt: "2026-02-24T12:05:01.000Z",
      testResults: [
        {
          id: "tr1000",
          groupName: "samples",
          testCaseName: "sample1",
          verdict: "AC",
          timeMs: 5,
          memoryKb: 1100,
          message: "Accepted",
        },
        {
          id: "tr1001",
          groupName: "samples",
          testCaseName: "sample2",
          verdict: "AC",
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
      status: "WA",
      score: 0,
      totalTimeMs: 20,
      peakMemoryKb: 3100,
      submittedAt: "2026-02-24T12:04:00.000Z",
      judgedAt: "2026-02-24T12:04:01.000Z",
      testResults: [
        {
          id: "tr1002",
          groupName: "samples",
          testCaseName: "sample1",
          verdict: "WA",
          timeMs: 10,
          memoryKb: 1500,
          message: "Expected output differs.",
        },
      ],
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

  return {
    users,
    problems,
    contests,
    submissions,
    reports,
    auditLogs,
    rejudgeRequests: [],
    counters: {
      problem: 1002,
      contest: 1001,
      submission: 1002,
      testResult: 1003,
      report: 1001,
      audit: 1001,
      rejudge: 1000,
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

function evaluateSubmissionStatus(sourceCode: string): SubmissionStatus {
  const normalized = sourceCode.toLowerCase();
  if (!sourceCode.trim()) {
    return "CE";
  }
  if (normalized.includes("compile_error")) {
    return "CE";
  }
  if (normalized.includes("runtime_error")) {
    return "RE";
  }
  if (normalized.includes("time_limit")) {
    return "TLE";
  }
  if (normalized.includes("memory_limit")) {
    return "MLE";
  }
  if (normalized.includes("wrong_answer")) {
    return "WA";
  }
  if (normalized.includes("internal_error")) {
    return "IE";
  }
  return "AC";
}

function runtimeFromSource(sourceCode: string): { timeMs: number; memoryKb: number } {
  const hash = sourceCode.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const timeMs = 5 + (hash % 70);
  const memoryKb = 1000 + (hash % 4000);
  return { timeMs, memoryKb };
}

function buildTestResults(status: SubmissionStatus): Submission["testResults"] {
  if (status === "AC") {
    return [
      {
        id: nextTestResultId(),
        groupName: "samples",
        testCaseName: "sample1",
        verdict: "AC",
        timeMs: 8,
        memoryKb: 1400,
        message: "Accepted",
      },
      {
        id: nextTestResultId(),
        groupName: "samples",
        testCaseName: "sample2",
        verdict: "AC",
        timeMs: 9,
        memoryKb: 1450,
        message: "Accepted",
      },
    ];
  }

  const messageByStatus: Record<SubmissionStatus, string> = {
    WJ: "Waiting for Judge",
    AC: "Accepted",
    WA: "Expected output differs.",
    TLE: "Time limit exceeded.",
    MLE: "Memory limit exceeded.",
    RE: "Runtime error.",
    CE: "Compile error.",
    IE: "Internal error.",
  };

  return [
    {
      id: nextTestResultId(),
      groupName: "samples",
      testCaseName: "sample1",
      verdict: status,
      timeMs: 20,
      memoryKb: 3000,
      message: messageByStatus[status],
    },
  ];
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

export function getCurrentUser(): User {
  const user = store.users.find((item) => item.id === CURRENT_USER_ID);
  if (!user) {
    throw new HttpError("current user not found", 500);
  }
  return user;
}

export function listUsers(): User[] {
  return [...store.users];
}

export function updateCurrentUserProfile(payload: {
  displayName?: string;
  bio?: string;
}): User {
  const user = getCurrentUser();
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

export function listProblemsForListView(viewerId: string): Problem[] {
  const viewer = findUser(viewerId);
  const isAdmin = viewer?.role === "admin";

  return [...store.problems]
    .filter((problem) =>
      canViewVisibility(problem.visibility, problem.authorId, viewerId, !!isAdmin, false),
    )
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
}

export function listPublicProblems(): Problem[] {
  return [...store.problems]
    .filter((problem) => problem.visibility === "public")
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
  return allowed ? problem : undefined;
}

export function createProblem(input: CreateProblemInput): Problem {
  uniqueSlugOrThrow("problem", input.slug);
  const user = getCurrentUser();
  assertActiveUser(user);

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
    visibility: input.visibility,
    timeLimitMs: input.timeLimitMs,
    memoryLimitMb: input.memoryLimitMb,
    supportedLanguages: input.supportedLanguages,
    scoringType: "sum",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  store.problems.unshift(problem);
  return problem;
}

export function updateProblem(problemId: string, input: UpdateProblemInput): Problem {
  const user = getCurrentUser();
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

export function createContest(input: CreateContestInput): Contest {
  uniqueSlugOrThrow("contest", input.slug);
  const user = getCurrentUser();
  assertActiveUser(user);

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

export function updateContest(contestId: string, input: UpdateContestInput): Contest {
  const user = getCurrentUser();
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

export function joinContest(contestId: string): Contest {
  const user = getCurrentUser();
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

export function listSubmissionsForViewer(viewerId: string): Submission[] {
  void viewerId;
  return [...store.submissions]
    .sort(
      (left, right) =>
        new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
    );
}

export function listRecentSubmissions(limit = 15): Submission[] {
  return [...store.submissions]
    .sort(
      (left, right) =>
        new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
    )
    .slice(0, limit);
}

export function getSubmissionById(submissionId: string): Submission | undefined {
  return store.submissions.find((submission) => submission.id === submissionId);
}

export function createSubmission(input: CreateSubmissionInput): Submission {
  const currentUser = getCurrentUser();
  assertActiveUser(currentUser);

  const problem = resolveProblemIfExists(input.problemId);
  if (!problem.supportedLanguages.includes(input.language)) {
    throw new HttpError("unsupported language", 400);
  }

  let contestId: string | null = null;
  if (input.contestId) {
    const contest = resolveContestIfExists(input.contestId);
    if (!contest.participantUserIds.includes(currentUser.id)) {
      throw new HttpError("join contest before submitting", 403);
    }
    if (getContestStatus(contest) !== "running") {
      throw new HttpError("contest submissions are allowed only while running", 403);
    }
    const included = contest.problems.some(
      (contestProblem) => contestProblem.problemId === problem.id,
    );
    if (!included) {
      throw new HttpError("problem is not included in this contest", 400);
    }
    contestId = contest.id;
  }

  enforceSubmissionRateLimit(currentUser.id, problem.id, isAdminBypass(currentUser));

  const status = evaluateSubmissionStatus(input.sourceCode);
  const runtime = runtimeFromSource(input.sourceCode);
  const judgedAt = nowIso();
  const submission: Submission = {
    id: nextSubmissionId(),
    userId: currentUser.id,
    problemId: problem.id,
    contestId,
    language: input.language,
    sourceCode: input.sourceCode,
    status,
    score: status === "AC" ? 100 : 0,
    totalTimeMs: runtime.timeMs,
    peakMemoryKb: runtime.memoryKb,
    submittedAt: judgedAt,
    judgedAt,
    testResults: buildTestResults(status),
  };

  store.submissions.unshift(submission);
  return submission;
}

function getWrongBeforeAccepted(
  orderedSubmissions: Submission[],
  acceptedAt: string | null,
): number {
  if (!acceptedAt) {
    return orderedSubmissions.filter((submission) => submission.status !== "AC").length;
  }
  return orderedSubmissions.filter(
    (submission) =>
      submission.status !== "AC" &&
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
  const inContestSubmissions = store.submissions.filter(
    (submission) => submission.contestId === contestId,
  );
  const participantIds = new Set<string>([
    ...contest.participantUserIds,
    ...inContestSubmissions.map((submission) => submission.userId),
  ]);

  const rows: ScoreboardRow[] = Array.from(participantIds).map((userId) => {
    const cells = contestProblems.map((contestProblem) => {
      const scoped = sortBySubmittedAtAsc(
        inContestSubmissions.filter(
          (submission) =>
            submission.userId === userId && submission.problemId === contestProblem.problemId,
        ),
      );

      const accepted = scoped.find((submission) => submission.status === "AC");
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

    return {
      userId,
      rank: 0,
      totalScore,
      penalty,
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

export function dumpStoreSnapshot(): {
  users: User[];
  problems: Problem[];
  contests: Contest[];
  submissions: Submission[];
  reports: Report[];
  auditLogs: AuditLog[];
  rejudgeRequests: RejudgeRequest[];
} {
  return {
    users: JSON.parse(JSON.stringify(store.users)) as User[],
    problems: JSON.parse(JSON.stringify(store.problems)) as Problem[],
    contests: JSON.parse(JSON.stringify(store.contests)) as Contest[],
    submissions: JSON.parse(JSON.stringify(store.submissions)) as Submission[],
    reports: JSON.parse(JSON.stringify(store.reports)) as Report[],
    auditLogs: JSON.parse(JSON.stringify(store.auditLogs)) as AuditLog[],
    rejudgeRequests: JSON.parse(JSON.stringify(store.rejudgeRequests)) as RejudgeRequest[],
  };
}

export function canViewSubmissionSource(submission: Submission, viewerId: string): boolean {
  const viewer = findUser(viewerId);
  return viewer?.role === "admin" || submission.userId === viewerId;
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
  if (canViewSource) {
    return {
      submission,
      canViewSource: true,
    };
  }

  return {
    submission: {
      ...submission,
      sourceCode: "// source code is hidden",
    },
    canViewSource: false,
  };
}

export function createReport(input: CreateReportInput): Report {
  const reporter = getCurrentUser();
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

export function listReportsForAdmin(): Report[] {
  const user = getCurrentUser();
  assertAdmin(user);
  return [...store.reports].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export function updateReportStatusByAdmin(
  reportId: string,
  status: ReportStatus,
  reason: string,
): Report {
  const user = getCurrentUser();
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

export function freezeUserByAdmin(userId: string, reason: string): User {
  const admin = getCurrentUser();
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

export function hideProblemByAdmin(problemId: string, reason: string): Problem {
  const admin = getCurrentUser();
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

export function hideContestByAdmin(contestId: string, reason: string): Contest {
  const admin = getCurrentUser();
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

export function listAuditLogsForAdmin(limit = 100): AuditLog[] {
  const user = getCurrentUser();
  assertAdmin(user);
  return [...store.auditLogs]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

export function listRejudgeRequestsForAdmin(limit = 50): RejudgeRequest[] {
  const user = getCurrentUser();
  assertAdmin(user);
  return [...store.rejudgeRequests]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

export function requestRejudge(input: RequestRejudgeInput): {
  request: RejudgeRequest;
  submission: Submission;
} {
  const actor = getCurrentUser();
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

  const newStatus = evaluateSubmissionStatus(submission.sourceCode);
  const runtime = runtimeFromSource(submission.sourceCode);
  submission.status = newStatus;
  submission.score = newStatus === "AC" ? 100 : 0;
  submission.totalTimeMs = runtime.timeMs;
  submission.peakMemoryKb = runtime.memoryKb;
  submission.judgedAt = nowIso();
  submission.testResults = buildTestResults(newStatus);

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

  return { request, submission };
}

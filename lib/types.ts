export type UserRole =
  | "guest"
  | "user"
  | "problem_author"
  | "contest_organizer"
  | "admin";

export type UserStatus = "active" | "frozen" | "deleted";

export type Visibility = "public" | "unlisted" | "private";

export type ContestStatus = "scheduled" | "running" | "ended";

export type SubmissionStatus =
  | "pending"
  | "queued"
  | "compiling"
  | "running"
  | "judging"
  | "accepted"
  | "wrong_answer"
  | "time_limit_exceeded"
  | "memory_limit_exceeded"
  | "runtime_error"
  | "compilation_error"
  | "internal_error"
  | "cancelled";

export type Language = "cpp" | "python" | "java" | "javascript";

export type ScoreboardVisibility = "hidden" | "partial" | "full";
export type TestCaseVisibility = "group_only" | "case_index_only" | "case_name_visible";
export type ExplanationVisibility = "always" | "contest_end" | "private";

export interface ProblemPackageSummary {
  fileName: string;
  zipSizeBytes: number;
  fileCount: number;
  samplePairs: number;
  testGroupCount: number;
  totalTestPairs: number;
  warnings: string[];
  validatedAt: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  role: UserRole;
  status: UserStatus;
  displayNameChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Problem {
  id: string;
  authorId: string;
  title: string;
  slug: string;
  statementMarkdown: string;
  inputDescription: string;
  outputDescription: string;
  constraintsMarkdown: string;
  explanationMarkdown: string;
  explanationVisibility: ExplanationVisibility;
  visibility: Visibility;
  difficulty: number | null;
  timeLimitMs: number;
  memoryLimitMb: number;
  scoringType: "sum" | "binary" | "sum_of_groups";
  testCaseVisibility: TestCaseVisibility;
  latestPackageSummary: ProblemPackageSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContestProblem {
  label: string;
  problemId: string;
  score: number;
  orderIndex: number;
}

export interface Contest {
  id: string;
  organizerId: string;
  title: string;
  slug: string;
  descriptionMarkdown: string;
  visibility: Visibility;
  startAt: string;
  endAt: string;
  penaltyMinutes: number;
  scoreboardVisibility: ScoreboardVisibility;
  problems: ContestProblem[];
  participantUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionTestResult {
  id: string;
  groupName: string;
  testCaseName: string;
  verdict: SubmissionStatus;
  timeMs: number;
  memoryKb: number;
  message: string;
}

export interface Submission {
  id: string;
  userId: string;
  problemId: string;
  contestId: string | null;
  language: Language;
  sourceCode: string;
  status: SubmissionStatus;
  score: number;
  totalTimeMs: number;
  peakMemoryKb: number;
  submittedAt: string;
  judgeStartedAt: string | null;
  judgedAt: string | null;
  judgeEnvironmentVersion: string | null;
  testResults: SubmissionTestResult[];
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ReportTargetType = "problem" | "contest" | "submission";

export type ReportStatus = "open" | "investigating" | "resolved" | "dismissed";

export interface Report {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  detail: string;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  detail: string;
}

export type AuditAction =
  | "profile.display_name.update"
  | "report.create"
  | "report.status.update"
  | "admin.user.freeze"
  | "admin.user.unfreeze"
  | "admin.user.role.update"
  | "admin.announcement.create"
  | "admin.announcement.hide"
  | "admin.problem.hide"
  | "admin.problem.explanation.hide"
  | "admin.contest.hide"
  | "submission.judge"
  | "submission.rejudge.request";

export interface AuditLog {
  id: string;
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  reason: string;
  metadata: Record<string, string>;
  createdAt: string;
}

export interface RejudgeRequest {
  id: string;
  requestedBy: string;
  submissionId: string;
  problemId: string;
  reason: string;
  detail: string;
  createdAt: string;
}

export interface ScoreboardProblemCell {
  label: string;
  score: number;
  acceptedAt: string | null;
  wrongSubmissions: number;
}

export interface ScoreboardRow {
  userId: string;
  rank: number;
  totalScore: number;
  penalty: number;
  lastAcceptedAt: string | null;
  cells: ScoreboardProblemCell[];
}

export interface CreateProblemInput {
  title: string;
  slug: string;
  statementMarkdown: string;
  inputDescription: string;
  outputDescription: string;
  constraintsMarkdown: string;
  explanationMarkdown: string;
  explanationVisibility: ExplanationVisibility;
  visibility: Visibility;
  difficulty: number | null;
  timeLimitMs: number;
  memoryLimitMb: number;
  testCaseVisibility: TestCaseVisibility;
}

export type UpdateProblemInput = Partial<CreateProblemInput>;

export interface CreateContestInput {
  title: string;
  slug: string;
  descriptionMarkdown: string;
  visibility: Visibility;
  startAt: string;
  endAt: string;
  penaltyMinutes: number;
  scoreboardVisibility: ScoreboardVisibility;
  problems: ContestProblem[];
}

export type UpdateContestInput = Partial<CreateContestInput>;

export interface CreateSubmissionInput {
  problemId: string;
  contestId: string | null;
  language: Language;
  sourceCode: string;
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
}

export interface RequestRejudgeInput {
  submissionId: string;
  reason: string;
  detail: string;
}

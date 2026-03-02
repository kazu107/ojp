import type { SubmissionStatus } from "@/lib/types";

export const WAITING_SUBMISSION_STATUSES: SubmissionStatus[] = [
  "pending",
  "queued",
  "compiling",
  "running",
  "judging",
];

export const FINAL_SUBMISSION_STATUSES: SubmissionStatus[] = [
  "accepted",
  "wrong_answer",
  "time_limit_exceeded",
  "memory_limit_exceeded",
  "runtime_error",
  "compilation_error",
  "internal_error",
  "cancelled",
];

export const SUBMISSION_STATUS_VALUES: SubmissionStatus[] = [
  ...WAITING_SUBMISSION_STATUSES,
  ...FINAL_SUBMISSION_STATUSES,
];

const WAITING_STATUS_SET = new Set<SubmissionStatus>(WAITING_SUBMISSION_STATUSES);
const FINAL_STATUS_SET = new Set<SubmissionStatus>(FINAL_SUBMISSION_STATUSES);

const LEGACY_STATUS_ALIAS: Record<string, SubmissionStatus> = {
  WJ: "queued",
  AC: "accepted",
  WA: "wrong_answer",
  TLE: "time_limit_exceeded",
  MLE: "memory_limit_exceeded",
  RE: "runtime_error",
  CE: "compilation_error",
  IE: "internal_error",
};

const FINAL_VERDICT_PRIORITY: Record<SubmissionStatus, number> = {
  pending: 100,
  queued: 100,
  compiling: 100,
  running: 100,
  judging: 100,
  cancelled: 90,
  compilation_error: 0,
  internal_error: 1,
  runtime_error: 2,
  memory_limit_exceeded: 3,
  time_limit_exceeded: 4,
  wrong_answer: 5,
  accepted: 6,
};

export function normalizeSubmissionStatus(raw: string | null | undefined): SubmissionStatus | undefined {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  if ((SUBMISSION_STATUS_VALUES as string[]).includes(trimmed)) {
    return trimmed as SubmissionStatus;
  }

  const upper = trimmed.toUpperCase();
  if (LEGACY_STATUS_ALIAS[upper]) {
    return LEGACY_STATUS_ALIAS[upper];
  }

  return undefined;
}

export function isWaitingSubmissionStatus(status: SubmissionStatus): boolean {
  return WAITING_STATUS_SET.has(status);
}

export function isFinalSubmissionStatus(status: SubmissionStatus): boolean {
  return FINAL_STATUS_SET.has(status);
}

export function isAcceptedSubmissionStatus(status: SubmissionStatus): boolean {
  return status === "accepted";
}

export function submissionStatusLabel(status: SubmissionStatus): string {
  switch (status) {
    case "accepted":
      return "AC";
    case "wrong_answer":
      return "WA";
    case "time_limit_exceeded":
      return "TLE";
    case "memory_limit_exceeded":
      return "MLE";
    case "runtime_error":
      return "RE";
    case "compilation_error":
      return "CE";
    case "internal_error":
      return "IE";
    case "pending":
      return "PENDING";
    case "queued":
      return "QUEUED";
    case "compiling":
      return "COMPILING";
    case "running":
      return "RUNNING";
    case "judging":
      return "JUDGING";
    case "cancelled":
      return "CANCELLED";
    default:
      return status;
  }
}

export function verdictPriority(status: SubmissionStatus): number {
  return FINAL_VERDICT_PRIORITY[status] ?? 100;
}

export function pickHighestPriorityVerdict(verdicts: SubmissionStatus[]): SubmissionStatus {
  let picked: SubmissionStatus = "accepted";
  for (const verdict of verdicts) {
    if (!isFinalSubmissionStatus(verdict)) {
      continue;
    }
    if (verdictPriority(verdict) < verdictPriority(picked)) {
      picked = verdict;
    }
  }
  return picked;
}

import {
  ContestStatus,
  ExplanationVisibility,
  Language,
  SubmissionStatus,
  TestCaseVisibility,
  Visibility,
} from "@/lib/types";

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function visibilityLabel(visibility: Visibility): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    case "private":
      return "Private";
    default:
      return visibility;
  }
}

export function languageLabel(language: Language): string {
  switch (language) {
    case "cpp":
      return "C++";
    case "python":
      return "Python";
    case "java":
      return "Java";
    case "javascript":
      return "JavaScript";
    default:
      return language;
  }
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

export function contestStatusLabel(status: ContestStatus): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "running":
      return "Running";
    case "ended":
      return "Ended";
    default:
      return status;
  }
}

export function testCaseVisibilityLabel(visibility: TestCaseVisibility): string {
  switch (visibility) {
    case "group_only":
      return "Group Only";
    case "case_index_only":
      return "Case Index Only";
    case "case_name_visible":
      return "Case Name Visible";
    default:
      return visibility;
  }
}

export function explanationVisibilityLabel(visibility: ExplanationVisibility): string {
  switch (visibility) {
    case "always":
      return "Always";
    case "contest_end":
      return "After Contest End";
    case "private":
      return "Private";
    default:
      return visibility;
  }
}

export function difficultyLabel(difficulty: number | null): string {
  if (difficulty === null) {
    return "Unrated";
  }
  return String(difficulty);
}

export function badgeClassForDifficulty(difficulty: number | null): string {
  if (difficulty === null) {
    return "badge badge-slate";
  }
  if (difficulty < 400) {
    return "badge badge-diff-gray";
  }
  if (difficulty < 800) {
    return "badge badge-diff-brown";
  }
  if (difficulty < 1200) {
    return "badge badge-diff-green";
  }
  if (difficulty < 1600) {
    return "badge badge-diff-cyan";
  }
  if (difficulty < 2000) {
    return "badge badge-diff-blue";
  }
  if (difficulty < 2400) {
    return "badge badge-diff-yellow";
  }
  if (difficulty < 2800) {
    return "badge badge-diff-orange";
  }
  return "badge badge-diff-red";
}

export function badgeClassForVisibility(visibility: Visibility): string {
  switch (visibility) {
    case "public":
      return "badge badge-green";
    case "unlisted":
      return "badge badge-amber";
    case "private":
      return "badge badge-slate";
    default:
      return "badge";
  }
}

export function badgeClassForSubmission(status: SubmissionStatus): string {
  switch (status) {
    case "accepted":
      return "badge badge-green";
    case "wrong_answer":
      return "badge badge-red";
    case "time_limit_exceeded":
    case "memory_limit_exceeded":
      return "badge badge-amber";
    case "compilation_error":
    case "runtime_error":
    case "internal_error":
    case "cancelled":
      return "badge badge-slate";
    case "pending":
    case "queued":
    case "compiling":
    case "running":
    case "judging":
      return "badge badge-blue";
    default:
      return "badge";
  }
}

export function badgeClassForContestStatus(status: ContestStatus): string {
  switch (status) {
    case "scheduled":
      return "badge badge-blue";
    case "running":
      return "badge badge-amber";
    case "ended":
      return "badge badge-green";
    default:
      return "badge";
  }
}

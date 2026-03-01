import { ContestStatus, Language, SubmissionStatus, Visibility } from "@/lib/types";

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
  return status;
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
    case "AC":
      return "badge badge-green";
    case "WA":
      return "badge badge-red";
    case "TLE":
    case "MLE":
      return "badge badge-amber";
    case "CE":
    case "RE":
    case "IE":
      return "badge badge-slate";
    case "WJ":
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

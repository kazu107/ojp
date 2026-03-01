import {
  ExplanationVisibility,
  Language,
  TestCaseVisibility,
  Visibility,
} from "@/lib/types";

const ALLOWED_LANGUAGES: Language[] = ["cpp", "python", "java", "javascript"];
const ALLOWED_VISIBILITIES: Visibility[] = ["public", "unlisted", "private"];
const ALLOWED_TEST_CASE_VISIBILITIES: TestCaseVisibility[] = [
  "group_only",
  "case_index_only",
  "case_name_visible",
];
const ALLOWED_EXPLANATION_VISIBILITIES: ExplanationVisibility[] = [
  "always",
  "contest_end",
  "private",
];

export function parseVisibility(raw: unknown, fallback: Visibility = "public"): Visibility {
  if (typeof raw === "string" && ALLOWED_VISIBILITIES.includes(raw as Visibility)) {
    return raw as Visibility;
  }
  return fallback;
}

export function parseLanguages(raw: unknown, fallback: Language[] = ALLOWED_LANGUAGES): Language[] {
  if (!Array.isArray(raw)) {
    return fallback;
  }

  const languages = raw.filter(
    (item): item is Language =>
      typeof item === "string" && ALLOWED_LANGUAGES.includes(item as Language),
  );

  return languages.length > 0 ? languages : fallback;
}

export function parseLanguage(raw: unknown, fallback: Language = "python"): Language {
  if (typeof raw === "string" && ALLOWED_LANGUAGES.includes(raw as Language)) {
    return raw as Language;
  }
  return fallback;
}

export function parsePositiveNumber(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return fallback;
}

export function parseNonNegativeNumber(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return fallback;
}

export function parseString(raw: unknown, fallback = ""): string {
  if (typeof raw === "string") {
    return raw;
  }
  return fallback;
}

export function parseOptionalString(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    return raw;
  }
  return undefined;
}

export function parseTestCaseVisibility(
  raw: unknown,
  fallback: TestCaseVisibility = "case_index_only",
): TestCaseVisibility {
  if (
    typeof raw === "string" &&
    ALLOWED_TEST_CASE_VISIBILITIES.includes(raw as TestCaseVisibility)
  ) {
    return raw as TestCaseVisibility;
  }
  return fallback;
}

export function parseExplanationVisibility(
  raw: unknown,
  fallback: ExplanationVisibility = "private",
): ExplanationVisibility {
  if (
    typeof raw === "string" &&
    ALLOWED_EXPLANATION_VISIBILITIES.includes(raw as ExplanationVisibility)
  ) {
    return raw as ExplanationVisibility;
  }
  return fallback;
}

import { Language, Visibility } from "@/lib/types";

const ALLOWED_LANGUAGES: Language[] = ["cpp", "python", "java", "javascript"];
const ALLOWED_VISIBILITIES: Visibility[] = ["public", "unlisted", "private"];

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

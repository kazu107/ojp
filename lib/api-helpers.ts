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

export function parseOptionalIntegerOrNull(raw: unknown): number | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  if (typeof raw === "number" && Number.isFinite(raw) && Number.isInteger(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (/^-?\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
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

export interface PaginationRequest {
  page: number;
  limit: number;
  cursor: string | null;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
  hasPrev: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
}

interface ParsePaginationOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null): number | null {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const offset = Number(decoded);
    if (!Number.isFinite(offset) || offset < 0) {
      return null;
    }
    return Math.floor(offset);
  } catch {
    return null;
  }
}

export function parsePaginationQuery(
  searchParams: URLSearchParams,
  options: ParsePaginationOptions = {},
): PaginationRequest {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 200;

  const rawPage = Number(searchParams.get("page"));
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  const rawLimit = Number(searchParams.get("limit"));
  const parsedLimit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : defaultLimit;
  const limit = Math.min(maxLimit, parsedLimit);

  const cursor = searchParams.get("cursor");
  return { page, limit, cursor };
}

export function paginateItems<T>(
  items: T[],
  pagination: PaginationRequest,
): { items: T[]; meta: PaginationMeta } {
  const total = items.length;
  const offsetFromCursor = decodeCursor(pagination.cursor);
  const start = offsetFromCursor ?? (pagination.page - 1) * pagination.limit;
  const safeStart = Math.max(0, Math.min(total, start));
  const end = Math.min(total, safeStart + pagination.limit);
  const paged = items.slice(safeStart, end);

  const hasNext = end < total;
  const hasPrev = safeStart > 0;
  const page = Math.floor(safeStart / pagination.limit) + 1;

  return {
    items: paged,
    meta: {
      page,
      limit: pagination.limit,
      total,
      hasNext,
      hasPrev,
      nextCursor: hasNext ? encodeCursor(end) : null,
      prevCursor: hasPrev ? encodeCursor(Math.max(0, safeStart - pagination.limit)) : null,
    },
  };
}

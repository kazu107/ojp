import { isSubmissionLanguage } from "./languages";
import { parseHeuristicConfig, type HeuristicConfig } from "./heuristic-config";
import { GridGame, isWellFormedText } from "./board-visualization";
import type { ProblemPackageExtracted } from "./problem-package";

export function allowsGamePreviewOrigin(
  origin: string | null,
  requestUrl: string,
  publicUrl?: string,
): boolean {
  if (origin === null) return true;
  try {
    // A reverse proxy can leave requestUrl with the internal HTTP origin.
    const expected = new URL(publicUrl ?? requestUrl);
    return (expected.protocol === "https:" || expected.protocol === "http:") &&
      origin === expected.origin;
  } catch {
    return false;
  }
}

export interface GamePreviewPayload {
  provider: "grid-game-preview-v1";
  config: HeuristicConfig;
  input: string;
}
export function isGamePreviewPayload(raw: unknown): raw is GamePreviewPayload {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as { provider?: unknown }).provider === "grid-game-preview-v1"
  );
}
export function gamePreviewPayload(
  config: unknown,
  input: unknown,
): GamePreviewPayload {
  const parsed = parseHeuristicConfig(config);
  if (!parsed.game || !parsed.board)
    throw new Error("This problem is not a grid game");
  if (
    typeof input !== "string" ||
    new TextEncoder().encode(input).length > 8192
  )
    throw new Error("Board input is limited to 8 KiB");
  new GridGame(input, parsed.board, parsed.game);
  return {
    provider: "grid-game-preview-v1",
    config: { ...parsed, seeds: {}, finalGroups: [] },
    input,
  };
}
export function gamePreviewPackage(
  payload: GamePreviewPayload,
): ProblemPackageExtracted {
  const safe = gamePreviewPayload(payload.config, payload.input);
  const base = {
    scoringType: "heuristic" as const,
    checkerType: "heuristic" as const,
    checkerLanguage: "javascript" as const,
    compareMode: "exact" as const,
    heuristic: safe.config,
  };
  return {
    ...base,
    checkerSourceCode: "// Built-in grid game referee",
    samples: [],
    groups: [
      {
        name: "public",
        score: 100,
        orderIndex: 0,
        tests: [{ name: "own-input", input: safe.input, output: "" }],
      },
    ],
    validation: {
      fileName: "public-grid-preview",
      zipSizeBytes: 0,
      fileCount: 0,
      samplePairs: 0,
      testGroupCount: 1,
      totalTestPairs: 1,
      warnings: [],
      config: {
        ...base,
        timeLimitMs: 3000,
        memoryLimitMb: 256,
        problem: {
          slug: null,
          visibility: null,
          explanationVisibility: null,
          difficulty: null,
          testCaseVisibility: null,
        },
        samples: [],
        groups: [{ name: "public", score: null, tests: 1 }],
      },
    },
  };
}
export async function readGamePreviewRequest(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body is required");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 131072) {
        await reader.cancel();
        throw new Error("Game preview request exceeds 128 KiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(joined),
  ) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid game preview request");
  if (
    typeof value.sourceCode === "string" &&
    (value.sourceCode.includes("\0") || !isWellFormedText(value.sourceCode))
  )
    throw new Error("Source code must be valid text without NUL characters");
  if (
    !isSubmissionLanguage(value.language) ||
    typeof value.sourceCode !== "string" ||
    !value.sourceCode.trim() ||
    new TextEncoder().encode(value.sourceCode).length > 65536
  )
    throw new Error(
      "Choose a language and provide at most 64 KiB of source code",
    );
  if (
    value.contestId !== undefined &&
    value.contestId !== null &&
    (typeof value.contestId !== "string" || value.contestId.length > 100)
  )
    throw new Error("Invalid contest ID");
  return {
    language: value.language,
    sourceCode: value.sourceCode,
    input: value.input,
    contestId: typeof value.contestId === "string" ? value.contestId : null,
  };
}

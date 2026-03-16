"use client";

import JSZip from "jszip";
import {
  ProblemPackageCompareMode,
  ProblemPackageInspectResult,
  ProblemPackageScoringType,
} from "@/lib/problem-package-types";
import {
  ExplanationVisibility,
  Language,
  TestCaseVisibility,
  Visibility,
} from "@/lib/types";

function normalizePath(entryName: string): string {
  return entryName.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function diffSet(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((item) => !right.has(item)).sort((a, b) => a.localeCompare(b));
}

function validatePairs(inSet: Set<string>, outSet: Set<string>, scope: string): void {
  if (inSet.size === 0 || outSet.size === 0) {
    throw new Error(`${scope} must include both .in and .out files`);
  }

  const missingOut = diffSet(inSet, outSet);
  if (missingOut.length > 0) {
    throw new Error(`${scope} is missing .out pair for: ${missingOut.join(", ")}`);
  }

  const missingIn = diffSet(outSet, inSet);
  if (missingIn.length > 0) {
    throw new Error(`${scope} is missing .in pair for: ${missingIn.join(", ")}`);
  }
}

function parseCompareMode(raw: unknown): ProblemPackageCompareMode {
  if (raw === "ignore_trailing_spaces" || raw === "ignore-trailing-spaces") {
    return "ignore_trailing_spaces";
  }
  return "exact";
}

function parseCheckerType(raw: unknown): "exact" | "special_judge" {
  if (raw === "special_judge" || raw === "custom_checker") {
    return "special_judge";
  }
  return "exact";
}

function parseCheckerLanguage(raw: unknown): Language {
  if (raw === "cpp" || raw === "python" || raw === "java" || raw === "javascript") {
    return raw;
  }
  return "python";
}

function parseVisibility(raw: unknown): Visibility | undefined {
  if (raw === "public" || raw === "unlisted" || raw === "private") {
    return raw;
  }
  return undefined;
}

function parseExplanationVisibility(raw: unknown): ExplanationVisibility | undefined {
  if (raw === "always" || raw === "contest_end" || raw === "private") {
    return raw;
  }
  return undefined;
}

function parseTestCaseVisibility(raw: unknown): TestCaseVisibility | undefined {
  if (raw === "group_only" || raw === "case_index_only" || raw === "case_name_visible") {
    return raw;
  }
  return undefined;
}

function toSlugSuggestion(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function trimBlankLines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\s*\n+|\n+\s*$/g, "").trimEnd();
}

function normalizeSectionHeading(
  raw: string,
): "input" | "output" | "constraints" | "explanation" | null {
  const normalized = raw.trim().toLowerCase().replace(/[：:]/g, "").replace(/\s+/g, "");
  if (normalized === "input") {
    return "input";
  }
  if (normalized === "output") {
    return "output";
  }
  if (normalized === "constraints" || normalized === "constraint") {
    return "constraints";
  }
  if (normalized === "explanation" || normalized === "editorial") {
    return "explanation";
  }
  return null;
}

function buildPrefillFromStatement(
  statementMarkdown: string,
  options: {
    timeLimitMs: number;
    memoryLimitMb: number;
    visibility?: Visibility;
    explanationVisibility?: ExplanationVisibility;
    difficulty?: number | null;
    testCaseVisibility?: TestCaseVisibility;
    slug?: string;
  },
) {
  const normalized = statementMarkdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const sections = {
    statement: [] as string[],
    input: [] as string[],
    output: [] as string[],
    constraints: [] as string[],
    explanation: [] as string[],
  };

  let currentSection: keyof typeof sections = "statement";
  let title = "";
  let firstContentSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!firstContentSeen && trimmed.length === 0) {
      continue;
    }

    if (!firstContentSeen && /^#\s+/.test(trimmed)) {
      title = trimmed.replace(/^#\s+/, "").trim();
      firstContentSeen = true;
      continue;
    }

    firstContentSeen = true;
    const headingMatch = /^##\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const nextSection = normalizeSectionHeading(headingMatch[1]);
      if (nextSection) {
        currentSection = nextSection;
        continue;
      }
    }
    sections[currentSection].push(line);
  }

  const statementBody = trimBlankLines(sections.statement.join("\n"));
  const inputDescription = trimBlankLines(sections.input.join("\n"));
  const outputDescription = trimBlankLines(sections.output.join("\n"));
  const constraintsMarkdown = trimBlankLines(sections.constraints.join("\n"));
  const explanationMarkdown = trimBlankLines(sections.explanation.join("\n"));
  const fallbackStatement = title
    ? trimBlankLines(normalized.replace(/^#\s+.+(\n|$)/, ""))
    : trimBlankLines(normalized);

  return {
    title,
    slugSuggestion: options.slug || (title ? toSlugSuggestion(title) : ""),
    statementMarkdown: statementBody || fallbackStatement,
    inputDescription,
    outputDescription,
    constraintsMarkdown,
    explanationMarkdown,
    timeLimitMs: options.timeLimitMs,
    memoryLimitMb: options.memoryLimitMb,
    visibility: options.visibility,
    explanationVisibility: options.explanationVisibility,
    difficulty: options.difficulty,
    testCaseVisibility: options.testCaseVisibility,
  };
}

function checkerSourceFileName(language: Language): string {
  switch (language) {
    case "cpp":
      return "checker/Main.cpp";
    case "python":
      return "checker/Main.py";
    case "java":
      return "checker/Main.java";
    case "javascript":
      return "checker/Main.js";
    default:
      return "checker/Main.txt";
  }
}

export async function inspectProblemPackageClient(
  file: File,
  onProgress?: (progress: { current: number; total: number; message: string }) => void,
): Promise<ProblemPackageInspectResult> {
  const zip = await JSZip.loadAsync(file);
  const fileEntries = Object.values(zip.files).filter((entry) => !entry.dir);
  const total = Math.max(1, fileEntries.length);
  const textByPath = new Map<string, string>();

  let index = 0;
  for (const entry of fileEntries) {
    index += 1;
    const normalizedPath = normalizePath(entry.name);
    onProgress?.({
      current: index,
      total,
      message: `Reading ${normalizedPath}`,
    });
    textByPath.set(normalizedPath, await entry.async("string"));
  }

  const statementMarkdown = textByPath.get("statement.md");
  if (!statementMarkdown) {
    throw new Error("statement.md is required");
  }

  const configRaw = textByPath.get("config.json");
  if (!configRaw) {
    throw new Error("config.json is required");
  }
  const config = JSON.parse(configRaw) as Record<string, unknown>;

  const scoringType =
    config.scoringType === "sum_of_groups" || config.scoringType === "sum"
      ? "sum_of_groups"
      : ("binary" as ProblemPackageScoringType);
  const checkerType = parseCheckerType(config.checkerType);
  const checkerLanguage =
    checkerType === "special_judge" ? parseCheckerLanguage(config.checkerLanguage) : null;
  const compareMode = parseCompareMode(config.compareMode);
  const problemConfig =
    config.problem && typeof config.problem === "object"
      ? (config.problem as Record<string, unknown>)
      : null;

  const sampleIn = new Set<string>();
  const sampleOut = new Set<string>();
  const testIn = new Map<string, Set<string>>();
  const testOut = new Map<string, Set<string>>();

  for (const filePath of textByPath.keys()) {
    const sampleMatch = /^samples\/(.+)\.(in|out)$/.exec(filePath);
    if (sampleMatch) {
      const [, baseName, extension] = sampleMatch;
      if (extension === "in") {
        sampleIn.add(baseName);
      } else {
        sampleOut.add(baseName);
      }
      continue;
    }

    const testMatch = /^tests\/([^/]+)\/(.+)\.(in|out)$/.exec(filePath);
    if (testMatch) {
      const [, groupName, caseName, extension] = testMatch;
      const target = extension === "in" ? testIn : testOut;
      const current = target.get(groupName) ?? new Set<string>();
      current.add(caseName);
      target.set(groupName, current);
    }
  }

  validatePairs(sampleIn, sampleOut, "samples");
  const configSamples = Array.isArray(config.samples) ? config.samples : [];
  const sampleConfigByName = new Map(
    configSamples
      .map((sample) => {
        if (typeof sample === "string") {
          return [sample, ""] as [string, string];
        }
        if (!sample || typeof sample !== "object") {
          return null;
        }
        const record = sample as Record<string, unknown>;
        if (typeof record.name !== "string" || !record.name.trim()) {
          return null;
        }
        return [
          record.name.trim(),
          typeof record.description === "string" ? record.description : "",
        ] as [string, string];
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  );
  const orderedSampleNames = [
    ...sampleConfigByName.keys(),
    ...[...sampleIn].filter((name) => !sampleConfigByName.has(name)).sort((a, b) =>
      a.localeCompare(b),
    ),
  ];

  const samples = orderedSampleNames.map((name, sampleIndex) => ({
    id: `sample-${sampleIndex + 1}`,
    name,
    description: sampleConfigByName.get(name) ?? "",
    input: textByPath.get(`samples/${name}.in`) ?? "",
    output: textByPath.get(`samples/${name}.out`) ?? "",
  }));

  const configGroups = Array.isArray(config.groups) ? config.groups : [];
  const orderedGroupNames = configGroups
    .map((group) => {
      if (typeof group === "string") {
        return group.trim();
      }
      if (!group || typeof group !== "object") {
        return "";
      }
      const record = group as Record<string, unknown>;
      return typeof record.name === "string" ? record.name.trim() : "";
    })
    .filter((name) => name.length > 0);
  const scoreByGroup = new Map(
    configGroups
      .map((group) => {
        if (!group || typeof group !== "object" || typeof group === "string") {
          return null;
        }
        const record = group as Record<string, unknown>;
        if (typeof record.name !== "string" || !record.name.trim()) {
          return null;
        }
        return [
          record.name.trim(),
          typeof record.score === "number" ? record.score : null,
        ] as [string, number | null];
      })
      .filter((entry): entry is [string, number | null] => Boolean(entry)),
  );

  const discoveredGroupNames = [...new Set([...testIn.keys(), ...testOut.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );
  const groupNames = [
    ...orderedGroupNames,
    ...discoveredGroupNames.filter((name) => !orderedGroupNames.includes(name)),
  ];

  const groups = groupNames.map((groupName, groupIndex) => {
    const inSet = testIn.get(groupName) ?? new Set<string>();
    const outSet = testOut.get(groupName) ?? new Set<string>();
    validatePairs(inSet, outSet, `tests/${groupName}`);
    const caseNames = [...inSet].sort((a, b) => a.localeCompare(b));
    return {
      id: `group-${groupIndex + 1}`,
      name: groupName,
      score: scoreByGroup.get(groupName) ?? null,
      tests: caseNames.map((caseName, caseIndex) => ({
        id: `group-${groupIndex + 1}-case-${caseIndex + 1}`,
        name: caseName,
        input: textByPath.get(`tests/${groupName}/${caseName}.in`) ?? "",
        output: textByPath.get(`tests/${groupName}/${caseName}.out`) ?? "",
        isLoaded: true,
      })),
    };
  });

  const checkerSourceCode =
    checkerLanguage && textByPath.has(checkerSourceFileName(checkerLanguage))
      ? textByPath.get(checkerSourceFileName(checkerLanguage)) ?? ""
      : "";

  return {
    package: {
      fileName: file.name,
      zipSizeBytes: file.size,
      fileCount: fileEntries.length,
      samplePairs: samples.length,
      testGroupCount: groups.length,
      totalTestPairs: groups.reduce((acc, group) => acc + group.tests.length, 0),
      config: {
        timeLimitMs:
          typeof config.timeLimitMs === "number" ? config.timeLimitMs : 2000,
        memoryLimitMb:
          typeof config.memoryLimitMb === "number" ? config.memoryLimitMb : 512,
        scoringType,
        checkerType,
        checkerLanguage,
        compareMode,
        problem: {
          slug:
            problemConfig && typeof problemConfig.slug === "string"
              ? problemConfig.slug
              : null,
          visibility: parseVisibility(problemConfig?.visibility) ?? null,
          explanationVisibility:
            parseExplanationVisibility(problemConfig?.explanationVisibility) ?? null,
          difficulty:
            typeof problemConfig?.difficulty === "number"
              ? problemConfig.difficulty
              : null,
          testCaseVisibility:
            parseTestCaseVisibility(problemConfig?.testCaseVisibility) ?? null,
        },
        samples: samples.map((sample) => ({
          name: sample.name,
          description: sample.description,
        })),
        groups: groups.map((group) => ({
          name: group.name,
          score: group.score,
          tests: group.tests.length,
        })),
      },
      warnings: [],
    },
    prefill: buildPrefillFromStatement(statementMarkdown, {
      timeLimitMs: typeof config.timeLimitMs === "number" ? config.timeLimitMs : 2000,
      memoryLimitMb: typeof config.memoryLimitMb === "number" ? config.memoryLimitMb : 512,
      visibility: parseVisibility(problemConfig?.visibility),
      explanationVisibility: parseExplanationVisibility(problemConfig?.explanationVisibility),
      difficulty:
        typeof problemConfig?.difficulty === "number" ? problemConfig.difficulty : undefined,
      testCaseVisibility: parseTestCaseVisibility(problemConfig?.testCaseVisibility),
      slug:
        problemConfig && typeof problemConfig.slug === "string"
          ? problemConfig.slug
          : undefined,
    }),
    draft: {
      sourceLabel: file.name,
      checkerType,
      checkerLanguage: checkerLanguage ?? "python",
      checkerSourceCode,
      compareMode,
      zipSizeBytes: file.size,
      fileCount: fileEntries.length,
      isPartial: false,
      samples,
      warnings: [],
      groups,
    },
  };
}

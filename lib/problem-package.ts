import AdmZip from "adm-zip";

import {
  ProblemPackageCompareMode,
  ProblemPackageEditorDraft,
  ProblemPackageEditorGroup,
  ProblemPackageEditorTestCase,
  ProblemPackageInspectResult,
  ProblemPackagePrefill,
  ProblemPackageScoringType,
} from "@/lib/problem-package-types";

const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 1000;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;

export type {
  ProblemPackageCompareMode,
  ProblemPackageEditorDraft,
  ProblemPackageInspectResult,
  ProblemPackagePrefill,
  ProblemPackageScoringType,
};

interface ConfigGroupSummary {
  name: string;
  score: number | null;
  tests: number;
}

interface ConfigSummary {
  timeLimitMs: number;
  memoryLimitMb: number;
  scoringType: ProblemPackageScoringType;
  checkerType: "exact";
  compareMode: ProblemPackageCompareMode;
  groups: ConfigGroupSummary[];
}

export interface ProblemPackageValidationResult {
  fileName: string;
  zipSizeBytes: number;
  fileCount: number;
  samplePairs: number;
  testGroupCount: number;
  totalTestPairs: number;
  config: ConfigSummary;
  warnings: string[];
}

export interface ProblemPackageTestCase {
  name: string;
  input: string;
  output: string;
}

export interface ProblemPackageTestGroup {
  name: string;
  score: number;
  orderIndex: number;
  tests: ProblemPackageTestCase[];
}

export interface ProblemPackageExtracted {
  validation: ProblemPackageValidationResult;
  scoringType: ProblemPackageScoringType;
  compareMode: ProblemPackageCompareMode;
  samples: ProblemPackageTestCase[];
  groups: ProblemPackageTestGroup[];
}

interface ParsedConfigGroup {
  name: string;
  score: number | null;
  tests: string[];
}

interface ParsedConfig {
  timeLimitMs: number;
  memoryLimitMb: number;
  scoringType: ProblemPackageScoringType;
  checkerType: "exact";
  compareMode: ProblemPackageCompareMode;
  groups: ParsedConfigGroup[];
  warnings: string[];
}

function normalizePath(entryName: string): string {
  return entryName.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function hasPathTraversal(normalizedPath: string): boolean {
  if (!normalizedPath || normalizedPath.includes("\0")) {
    return true;
  }
  if (normalizedPath.startsWith("/") || /^[A-Za-z]:/.test(normalizedPath)) {
    return true;
  }
  return normalizedPath.split("/").some((segment) => segment === "..");
}

function pushToSetMap(target: Map<string, Set<string>>, key: string, value: string): void {
  const current = target.get(key) ?? new Set<string>();
  current.add(value);
  target.set(key, current);
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

function parsePositiveNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return value;
}

function parseNonNegativeInteger(value: unknown, fieldName: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

function parseScoringType(raw: unknown): ProblemPackageScoringType | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  if (raw === "binary") {
    return "binary";
  }
  if (raw === "sum_of_groups" || raw === "sum") {
    return "sum_of_groups";
  }
  throw new Error("config.scoringType must be one of: binary, sum_of_groups");
}

function parseCompareMode(raw: unknown): ProblemPackageCompareMode {
  if (raw === undefined || raw === null || raw === "") {
    return "exact";
  }
  if (raw === "exact") {
    return raw;
  }
  if (raw === "ignore_trailing_spaces" || raw === "ignore-trailing-spaces") {
    return "ignore_trailing_spaces";
  }
  throw new Error(
    "config.compareMode (or outputCompareMode) must be one of: exact, ignore_trailing_spaces",
  );
}

function resolveCompareMode(config: Record<string, unknown>): ProblemPackageCompareMode {
  if (config.compareMode !== undefined) {
    return parseCompareMode(config.compareMode);
  }
  if (config.outputCompareMode !== undefined) {
    return parseCompareMode(config.outputCompareMode);
  }
  if (config.output_compare_mode !== undefined) {
    return parseCompareMode(config.output_compare_mode);
  }
  return "exact";
}

function parseConfigGroup(value: unknown, index: number): ParsedConfigGroup {
  if (typeof value === "string") {
    const name = value.trim();
    if (!name) {
      throw new Error(`config.groups[${index}] must not be empty`);
    }
    return {
      name,
      score: null,
      tests: [],
    };
  }

  if (!value || typeof value !== "object") {
    throw new Error(`config.groups[${index}] must be a string or object`);
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) {
    throw new Error(`config.groups[${index}].name must be a non-empty string`);
  }

  let score: number | null = null;
  if (record.score !== undefined && record.score !== null && record.score !== "") {
    score = parseNonNegativeInteger(record.score, `config.groups[${index}].score`);
  }

  const testsRaw = record.tests;
  let tests: string[] = [];
  if (testsRaw !== undefined && testsRaw !== null && testsRaw !== "") {
    if (!Array.isArray(testsRaw)) {
      throw new Error(`config.groups[${index}].tests must be an array when provided`);
    }
    tests = testsRaw.map((item, testIndex) => {
      if (typeof item !== "string" || !item.trim()) {
        throw new Error(`config.groups[${index}].tests[${testIndex}] must be a non-empty string`);
      }
      return item.trim();
    });
  }

  return {
    name: record.name.trim(),
    score,
    tests,
  };
}

function parseConfig(configJson: unknown): ParsedConfig {
  if (!configJson || typeof configJson !== "object") {
    throw new Error("config.json must be a JSON object");
  }

  const config = configJson as Record<string, unknown>;

  if (
    typeof config.checkerType === "string" &&
    config.checkerType !== "exact"
  ) {
    throw new Error("config.checkerType currently supports only 'exact'");
  }

  if (!Array.isArray(config.groups) || config.groups.length === 0) {
    throw new Error("config.groups must be a non-empty array");
  }

  const groups = config.groups.map((group, index) => parseConfigGroup(group, index));
  const requestedScoringType = parseScoringType(config.scoringType);
  const warnings: string[] = [];
  const hasAnyPartialScore = groups.some((group) => group.score !== null);
  const hasAllPartialScores = groups.every((group) => group.score !== null);

  if (hasAnyPartialScore && !hasAllPartialScores) {
    throw new Error(
      "config.groups[*].score must be either set for all groups or omitted for all groups",
    );
  }

  let scoringType: ProblemPackageScoringType;
  if (hasAllPartialScores) {
    if (requestedScoringType === "binary") {
      warnings.push(
        "config.groups[*].score is set, so scoringType is treated as sum_of_groups.",
      );
    }

    const totalScore = groups.reduce((acc, group) => acc + (group.score ?? 0), 0);
    if (totalScore !== 100) {
      throw new Error("sum of config.groups[*].score must be exactly 100");
    }
    scoringType = "sum_of_groups";
  } else {
    scoringType = "binary";
    if (requestedScoringType === "sum_of_groups") {
      warnings.push(
        "config.groups[*].score is omitted, so scoringType is treated as binary (all groups must pass for 100 points).",
      );
    }
  }

  return {
    timeLimitMs: parsePositiveNumber(config.timeLimitMs, "config.timeLimitMs"),
    memoryLimitMb: parsePositiveNumber(config.memoryLimitMb, "config.memoryLimitMb"),
    scoringType,
    checkerType: "exact",
    compareMode: resolveCompareMode(config),
    groups,
    warnings,
  };
}

function parseConfigFromEntry(
  entryByPath: ReadonlyMap<string, AdmZip.IZipEntry>,
): ParsedConfig {
  const configEntry = entryByPath.get("config.json");
  if (!configEntry) {
    throw new Error("config.json is required");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(configEntry.getData().toString("utf8"));
  } catch {
    throw new Error("config.json must be valid UTF-8 JSON");
  }

  return parseConfig(parsed);
}

function casePath(groupName: string, caseName: string, ext: "in" | "out"): string {
  return `tests/${groupName}/${caseName}.${ext}`;
}

function samplePath(caseName: string, ext: "in" | "out"): string {
  return `samples/${caseName}.${ext}`;
}

function buildSampleCases(
  entryByPath: ReadonlyMap<string, AdmZip.IZipEntry>,
  sampleIn: ReadonlySet<string>,
): ProblemPackageTestCase[] {
  return [...sampleIn]
    .sort((a, b) => a.localeCompare(b))
    .map((caseName) => {
      const inEntry = entryByPath.get(samplePath(caseName, "in"));
      const outEntry = entryByPath.get(samplePath(caseName, "out"));
      if (!inEntry || !outEntry) {
        throw new Error(`samples/${caseName}.in/.out is required`);
      }
      return {
        name: caseName,
        input: inEntry.getData().toString("utf8"),
        output: outEntry.getData().toString("utf8"),
      };
    });
}

function buildTestGroups(
  config: ParsedConfig,
  entryByPath: ReadonlyMap<string, AdmZip.IZipEntry>,
  testIn: ReadonlyMap<string, Set<string>>,
  testOut: ReadonlyMap<string, Set<string>>,
): {
  groups: ProblemPackageTestGroup[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const allGroupNames = new Set<string>([...testIn.keys(), ...testOut.keys()]);
  const configGroupNames = new Set(config.groups.map((group) => group.name));

  for (const groupName of configGroupNames) {
    if (!allGroupNames.has(groupName)) {
      warnings.push(`config.groups has '${groupName}', but tests/${groupName} is missing.`);
    }
  }
  for (const groupName of allGroupNames) {
    if (!configGroupNames.has(groupName)) {
      warnings.push(`tests/${groupName} exists, but config.groups does not include it.`);
    }
  }

  const configByName = new Map(config.groups.map((group) => [group.name, group]));
  const orderedGroupNames = [
    ...config.groups.map((group) => group.name),
    ...[...allGroupNames].filter((name) => !configByName.has(name)).sort((a, b) => a.localeCompare(b)),
  ];

  const groups: ProblemPackageTestGroup[] = [];
  for (const [index, groupName] of orderedGroupNames.entries()) {
    const inSet = testIn.get(groupName) ?? new Set<string>();
    const outSet = testOut.get(groupName) ?? new Set<string>();
    validatePairs(inSet, outSet, `tests/${groupName}`);

    const configured = configByName.get(groupName);
    const discoveredCases = [...inSet].sort((a, b) => a.localeCompare(b));
    const caseNames = configured && configured.tests.length > 0 ? configured.tests : discoveredCases;

    const tests = caseNames.map((caseName) => {
      const inEntry = entryByPath.get(casePath(groupName, caseName, "in"));
      const outEntry = entryByPath.get(casePath(groupName, caseName, "out"));
      if (!inEntry || !outEntry) {
        throw new Error(`tests/${groupName}/${caseName}.in/.out is required by config.groups`);
      }
      return {
        name: caseName,
        input: inEntry.getData().toString("utf8"),
        output: outEntry.getData().toString("utf8"),
      };
    });

    groups.push({
      name: groupName,
      score: configured?.score ?? 0,
      orderIndex: index,
      tests,
    });
  }

  return { groups, warnings };
}

export function validateProblemPackage(
  fileName: string,
  zipBuffer: Buffer,
): ProblemPackageExtracted {
  if (!fileName.toLowerCase().endsWith(".zip")) {
    throw new Error("package file must be a .zip");
  }

  if (zipBuffer.byteLength <= 0) {
    throw new Error("package file is empty");
  }

  if (zipBuffer.byteLength > MAX_ZIP_BYTES) {
    throw new Error(`zip size exceeds limit (${MAX_ZIP_BYTES} bytes)`);
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new Error("invalid zip archive");
  }

  const entries = zip.getEntries();
  const files = entries.filter((entry) => !entry.isDirectory);
  if (files.length === 0) {
    throw new Error("zip archive has no files");
  }
  if (files.length > MAX_FILES) {
    throw new Error(`file count exceeds limit (${MAX_FILES})`);
  }

  const entryByPath = new Map<string, AdmZip.IZipEntry>();
  let expandedBytes = 0;
  for (const entry of files) {
    const normalizedPath = normalizePath(entry.entryName);
    if (hasPathTraversal(normalizedPath)) {
      throw new Error(`unsafe path is not allowed: ${entry.entryName}`);
    }
    if (entryByPath.has(normalizedPath)) {
      throw new Error(`duplicate file path: ${normalizedPath}`);
    }

    const size = entry.header.size;
    if (size > MAX_SINGLE_FILE_BYTES) {
      throw new Error(
        `single file size exceeds limit (${MAX_SINGLE_FILE_BYTES} bytes): ${normalizedPath}`,
      );
    }

    expandedBytes += size;
    if (expandedBytes > MAX_EXPANDED_BYTES) {
      throw new Error(`expanded total size exceeds limit (${MAX_EXPANDED_BYTES} bytes)`);
    }

    entryByPath.set(normalizedPath, entry);
  }

  if (!entryByPath.has("statement.md")) {
    throw new Error("statement.md is required");
  }

  const sampleIn = new Set<string>();
  const sampleOut = new Set<string>();
  const testIn = new Map<string, Set<string>>();
  const testOut = new Map<string, Set<string>>();

  for (const filePath of entryByPath.keys()) {
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
      if (extension === "in") {
        pushToSetMap(testIn, groupName, caseName);
      } else {
        pushToSetMap(testOut, groupName, caseName);
      }
    }
  }

  validatePairs(sampleIn, sampleOut, "samples");
  const samples = buildSampleCases(entryByPath, sampleIn);

  const groupNames = new Set<string>([...testIn.keys(), ...testOut.keys()]);
  if (groupNames.size === 0) {
    throw new Error("tests/<group-name>/*.in and *.out are required");
  }

  const config = parseConfigFromEntry(entryByPath);
  const { groups, warnings: groupWarnings } = buildTestGroups(config, entryByPath, testIn, testOut);
  const warnings = [...config.warnings, ...groupWarnings];
  const totalTestPairs = groups.reduce((acc, group) => acc + group.tests.length, 0);
  const testsByGroupName = new Map(groups.map((group) => [group.name, group.tests.length]));

  const validation: ProblemPackageValidationResult = {
    fileName,
    zipSizeBytes: zipBuffer.byteLength,
    fileCount: files.length,
    samplePairs: sampleIn.size,
    testGroupCount: groups.length,
    totalTestPairs,
    config: {
      timeLimitMs: config.timeLimitMs,
      memoryLimitMb: config.memoryLimitMb,
      scoringType: config.scoringType,
      checkerType: config.checkerType,
      compareMode: config.compareMode,
      groups: config.groups.map((group) => ({
        name: group.name,
        score: group.score,
        tests: testsByGroupName.get(group.name) ?? 0,
      })),
    },
    warnings,
  };

  return {
    validation,
    scoringType: config.scoringType,
    compareMode: config.compareMode,
    samples,
    groups,
  };
}

function trimBlankLines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\s*\n+|\n+\s*$/g, "").trimEnd();
}

function toSlugSuggestion(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSectionHeading(raw: string): "input" | "output" | "constraints" | "explanation" | null {
  const normalized = raw.trim().toLowerCase().replace(/[：:]/g, "").replace(/\s+/g, "");
  if (normalized === "input" || normalized === "入力") {
    return "input";
  }
  if (normalized === "output" || normalized === "出力") {
    return "output";
  }
  if (normalized === "constraints" || normalized === "constraint" || normalized === "制約") {
    return "constraints";
  }
  if (normalized === "explanation" || normalized === "editorial" || normalized === "解説") {
    return "explanation";
  }
  return null;
}

function buildPrefillFromStatement(
  statementMarkdown: string,
  options: {
    timeLimitMs: number;
    memoryLimitMb: number;
  },
): ProblemPackagePrefill {
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
  const fallbackStatement = title ? trimBlankLines(normalized.replace(/^#\s+.+(\n|$)/, "")) : trimBlankLines(normalized);

  return {
    title,
    slugSuggestion: title ? toSlugSuggestion(title) : "",
    statementMarkdown: statementBody || fallbackStatement,
    inputDescription,
    outputDescription,
    constraintsMarkdown,
    explanationMarkdown,
    timeLimitMs: options.timeLimitMs,
    memoryLimitMb: options.memoryLimitMb,
  };
}

function readStatementMarkdown(zipBuffer: Buffer): string {
  const zip = new AdmZip(zipBuffer);
  const entry =
    zip
      .getEntries()
      .find((candidate) => !candidate.isDirectory && normalizePath(candidate.entryName) === "statement.md") ??
    null;
  if (!entry) {
    throw new Error("statement.md is required");
  }
  return entry.getData().toString("utf8");
}

function sanitizeGroupName(name: string, fieldName: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`${fieldName} must not include '/' or '\\'`);
  }
  return trimmed;
}

function buildScoringTypeFromEditorGroups(
  groups: Array<{ score: number | null }>,
): ProblemPackageScoringType {
  const hasAnyPartialScore = groups.some((group) => group.score !== null);
  const hasAllPartialScores = groups.every((group) => group.score !== null);

  if (hasAnyPartialScore && !hasAllPartialScores) {
    throw new Error("all group scores must be set together, or all omitted");
  }

  if (hasAllPartialScores) {
    const totalScore = groups.reduce((acc, group) => acc + (group.score ?? 0), 0);
    if (totalScore !== 100) {
      throw new Error("sum of group scores must be exactly 100");
    }
    return "sum_of_groups";
  }

  return "binary";
}

export function buildEditorDraftFromExtracted(
  extracted: ProblemPackageExtracted,
): ProblemPackageEditorDraft {
  return {
    sourceLabel: extracted.validation.fileName,
    compareMode: extracted.compareMode,
    zipSizeBytes: extracted.validation.zipSizeBytes,
    fileCount: extracted.validation.fileCount,
    samples: extracted.samples.map((sample, sampleIndex): ProblemPackageEditorTestCase => ({
      id: `sample-${sampleIndex + 1}`,
      name: sample.name,
      input: sample.input,
      output: sample.output,
    })),
    warnings: [...extracted.validation.warnings],
    groups: extracted.groups.map((group, groupIndex): ProblemPackageEditorGroup => ({
      id: `group-${groupIndex + 1}`,
      name: group.name,
      score: extracted.scoringType === "sum_of_groups" ? group.score : null,
      tests: group.tests.map((test, testIndex): ProblemPackageEditorTestCase => ({
        id: `group-${groupIndex + 1}-case-${testIndex + 1}`,
        name: test.name,
        input: test.input,
        output: test.output,
      })),
    })),
  };
}

export function buildProblemPackageFromEditorDraft(input: {
  sourceLabel?: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  compareMode?: ProblemPackageCompareMode;
  zipSizeBytes?: number;
  fileCount?: number;
  samples?: ProblemPackageEditorTestCase[];
  warnings?: string[];
  groups: ProblemPackageEditorGroup[];
}): ProblemPackageExtracted {
  const timeLimitMs = parsePositiveNumber(input.timeLimitMs, "timeLimitMs");
  const memoryLimitMb = parsePositiveNumber(input.memoryLimitMb, "memoryLimitMb");

  if (!Array.isArray(input.groups) || input.groups.length === 0) {
    throw new Error("at least one test group is required");
  }

  const seenGroupNames = new Set<string>();
  const groups = input.groups.map((group, groupIndex) => {
    const groupName = sanitizeGroupName(group.name, `groups[${groupIndex}].name`);
    if (seenGroupNames.has(groupName)) {
      throw new Error(`duplicate group name: ${groupName}`);
    }
    seenGroupNames.add(groupName);

    let score: number | null = null;
    if (group.score !== null && group.score !== undefined) {
      score = parseNonNegativeInteger(group.score, `groups[${groupIndex}].score`);
    }

    if (!Array.isArray(group.tests) || group.tests.length === 0) {
      throw new Error(`groups[${groupIndex}] must contain at least one test case`);
    }

    const seenCaseNames = new Set<string>();
    const tests = group.tests.map((test, testIndex) => {
      const caseName = sanitizeGroupName(
        test.name,
        `groups[${groupIndex}].tests[${testIndex}].name`,
      );
      if (seenCaseNames.has(caseName)) {
        throw new Error(`duplicate test case name in ${groupName}: ${caseName}`);
      }
      seenCaseNames.add(caseName);

      if (typeof test.input !== "string" || typeof test.output !== "string") {
        throw new Error(`groups[${groupIndex}].tests[${testIndex}] must include input/output`);
      }

      return {
        name: caseName,
        input: test.input,
        output: test.output,
      };
    });

    return {
      name: groupName,
      score,
      orderIndex: groupIndex,
      tests,
    };
  });

  const scoringType = buildScoringTypeFromEditorGroups(groups);
  const seenSampleNames = new Set<string>();
  const samples = Array.isArray(input.samples)
    ? input.samples.map((sample, sampleIndex) => {
        const caseName = sanitizeGroupName(sample.name, `samples[${sampleIndex}].name`);
        if (seenSampleNames.has(caseName)) {
          throw new Error(`duplicate sample name: ${caseName}`);
        }
        seenSampleNames.add(caseName);
        if (typeof sample.input !== "string" || typeof sample.output !== "string") {
          throw new Error(`samples[${sampleIndex}] must include input/output`);
        }
        return {
          name: caseName,
          input: sample.input,
          output: sample.output,
        };
      })
    : [];

  const compareMode = input.compareMode ?? "exact";
  const fileName = input.sourceLabel?.trim() || "manual-package";
  const zipSizeBytes = parseNonNegativeInteger(input.zipSizeBytes ?? 0, "zipSizeBytes");
  const totalTestPairs = groups.reduce((acc, group) => acc + group.tests.length, 0);
  const computedFileCount = 2 + (samples.length + totalTestPairs) * 2;
  const requestedFileCount =
    input.fileCount === undefined || input.fileCount === null || input.fileCount <= 0
      ? computedFileCount
      : input.fileCount;
  const fileCount = parseNonNegativeInteger(requestedFileCount, "fileCount");
  const samplePairs = samples.length;
  const warnings = Array.isArray(input.warnings)
    ? input.warnings.filter((warning): warning is string => typeof warning === "string" && warning.trim().length > 0)
    : [];

  return {
    validation: {
      fileName,
      zipSizeBytes,
      fileCount,
      samplePairs,
      testGroupCount: groups.length,
      totalTestPairs,
      config: {
        timeLimitMs,
        memoryLimitMb,
        scoringType,
        checkerType: "exact",
        compareMode,
        groups: groups.map((group) => ({
          name: group.name,
          score: scoringType === "sum_of_groups" ? group.score : null,
          tests: group.tests.length,
        })),
      },
      warnings,
    },
    scoringType,
    compareMode,
    samples,
    groups: groups.map((group) => ({
      name: group.name,
      score: group.score ?? 0,
      orderIndex: group.orderIndex,
      tests: group.tests,
    })),
  };
}

export function inspectProblemPackage(
  fileName: string,
  zipBuffer: Buffer,
): ProblemPackageInspectResult {
  const extracted = validateProblemPackage(fileName, zipBuffer);
  const statementMarkdown = readStatementMarkdown(zipBuffer);

  return {
    package: extracted.validation,
    prefill: buildPrefillFromStatement(statementMarkdown, {
      timeLimitMs: extracted.validation.config.timeLimitMs,
      memoryLimitMb: extracted.validation.config.memoryLimitMb,
    }),
    draft: buildEditorDraftFromExtracted(extracted),
  };
}

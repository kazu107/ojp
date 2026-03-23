import AdmZip from "adm-zip";

import {
  ProblemPackageCompareMode,
  ProblemPackageCheckerType,
  ProblemPackageEditorDraft,
  ProblemPackageEditorGroup,
  ProblemPackageEditorSampleCase,
  ProblemPackageEditorTestCase,
  ProblemPackageInspectResult,
  ProblemPackagePrefill,
  ProblemPackageScoringType,
} from "@/lib/problem-package-types";
import {
  ExplanationVisibility,
  Language,
  TestCaseVisibility,
  Visibility,
} from "@/lib/types";

const MAX_ZIP_BYTES = 256 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 4000;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;

export type {
  ProblemPackageCompareMode,
  ProblemPackageCheckerType,
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

interface ConfigSampleSummary {
  name: string;
  description: string;
}

interface ConfigSummary {
  timeLimitMs: number;
  memoryLimitMb: number;
  scoringType: ProblemPackageScoringType;
  checkerType: ProblemPackageCheckerType;
  checkerLanguage: Language | null;
  compareMode: ProblemPackageCompareMode;
  problem: {
    slug: string | null;
    visibility: Visibility | null;
    explanationVisibility: ExplanationVisibility | null;
    difficulty: number | null;
    testCaseVisibility: TestCaseVisibility | null;
  };
  samples: ConfigSampleSummary[];
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

export interface ProblemPackageSampleCase extends ProblemPackageTestCase {
  description: string;
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
  checkerType: ProblemPackageCheckerType;
  checkerLanguage: Language | null;
  checkerSourceCode: string | null;
  compareMode: ProblemPackageCompareMode;
  samples: ProblemPackageSampleCase[];
  groups: ProblemPackageTestGroup[];
}

export interface ProblemPackageManifest {
  validation: ProblemPackageValidationResult;
  scoringType: ProblemPackageScoringType;
  checkerType: ProblemPackageCheckerType;
  checkerLanguage: Language | null;
  compareMode: ProblemPackageCompareMode;
  sampleCases: ProblemPackageSampleCase[];
}

interface ParsedConfigSample {
  name: string;
  description: string;
}

interface ParsedConfigGroup {
  name: string;
  score: number | null;
  tests: string[];
}

export interface ParsedConfig {
  timeLimitMs: number;
  memoryLimitMb: number;
  scoringType: ProblemPackageScoringType;
  checkerType: ProblemPackageCheckerType;
  checkerLanguage: Language | null;
  checkerSourceCode: string | null;
  compareMode: ProblemPackageCompareMode;
  problemSettings: {
    slug?: string;
    visibility?: Visibility;
    explanationVisibility?: ExplanationVisibility;
    difficulty?: number | null;
    testCaseVisibility?: TestCaseVisibility;
  };
  samples: ParsedConfigSample[];
  groups: ParsedConfigGroup[];
  warnings: string[];
}

export function normalizePath(entryName: string): string {
  return entryName.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function hasPathTraversal(normalizedPath: string): boolean {
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
  return [...left].filter((item) => !right.has(item)).sort(naturalNameCompare);
}

function naturalNameCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function stripUtf8Bom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function normalizePackageText(text: string): string {
  return stripUtf8Bom(text).replace(/\r\n?/g, "\n");
}

export function validatePairs(inSet: Set<string>, outSet: Set<string>, scope: string): void {
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

function parseCheckerType(raw: unknown): ProblemPackageCheckerType {
  if (raw === undefined || raw === null || raw === "" || raw === "exact") {
    return "exact";
  }
  if (raw === "special_judge" || raw === "custom_checker") {
    return "special_judge";
  }
  throw new Error("config.checkerType must be one of: exact, special_judge");
}

function parseCheckerLanguage(raw: unknown): Language {
  if (raw === "cpp" || raw === "python" || raw === "java" || raw === "javascript") {
    return raw;
  }
  throw new Error("config.checkerLanguage must be one of: cpp, python, java, javascript");
}

function parseVisibility(raw: unknown): Visibility {
  if (raw === "public" || raw === "unlisted" || raw === "private") {
    return raw;
  }
  throw new Error("config.problem.visibility must be one of: public, unlisted, private");
}

function parseExplanationVisibility(raw: unknown): ExplanationVisibility {
  if (raw === "always" || raw === "contest_end" || raw === "private") {
    return raw;
  }
  throw new Error(
    "config.problem.explanationVisibility must be one of: always, contest_end, private",
  );
}

function parseTestCaseVisibility(raw: unknown): TestCaseVisibility {
  if (raw === "group_only" || raw === "case_index_only" || raw === "case_name_visible") {
    return raw;
  }
  throw new Error(
    "config.problem.testCaseVisibility must be one of: group_only, case_index_only, case_name_visible",
  );
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

export function checkerSourceFileName(language: Language): string {
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

function parseConfigSample(value: unknown, index: number): ParsedConfigSample {
  if (typeof value === "string") {
    const name = value.trim();
    if (!name) {
      throw new Error(`config.samples[${index}] must not be empty`);
    }
    return {
      name,
      description: "",
    };
  }

  if (!value || typeof value !== "object") {
    throw new Error(`config.samples[${index}] must be a string or object`);
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) {
    throw new Error(`config.samples[${index}].name must be a non-empty string`);
  }

  return {
    name: record.name.trim(),
    description:
      typeof record.description === "string" ? record.description : "",
  };
}

export function parseConfig(configJson: unknown): ParsedConfig {
  if (!configJson || typeof configJson !== "object") {
    throw new Error("config.json must be a JSON object");
  }

  const config = configJson as Record<string, unknown>;

  const checkerType = parseCheckerType(config.checkerType);
  let checkerLanguage: Language | null = null;
  if (checkerType === "special_judge") {
    checkerLanguage = parseCheckerLanguage(config.checkerLanguage);
  }

  const problemSettings: ParsedConfig["problemSettings"] = {};
  if (config.problem !== undefined) {
    if (!config.problem || typeof config.problem !== "object") {
      throw new Error("config.problem must be an object when provided");
    }
    const problem = config.problem as Record<string, unknown>;
    if (problem.slug !== undefined) {
      if (typeof problem.slug !== "string" || !problem.slug.trim()) {
        throw new Error("config.problem.slug must be a non-empty string");
      }
      problemSettings.slug = problem.slug.trim();
    }
    if (problem.visibility !== undefined) {
      problemSettings.visibility = parseVisibility(problem.visibility);
    }
    if (problem.explanationVisibility !== undefined) {
      problemSettings.explanationVisibility = parseExplanationVisibility(
        problem.explanationVisibility,
      );
    }
    if (problem.difficulty !== undefined) {
      if (problem.difficulty === null || problem.difficulty === "") {
        problemSettings.difficulty = null;
      } else {
        problemSettings.difficulty = parseNonNegativeInteger(
          problem.difficulty,
          "config.problem.difficulty",
        );
      }
    }
    if (problem.testCaseVisibility !== undefined) {
      problemSettings.testCaseVisibility = parseTestCaseVisibility(problem.testCaseVisibility);
    }
  }

  if (!Array.isArray(config.groups) || config.groups.length === 0) {
    throw new Error("config.groups must be a non-empty array");
  }

  const samples = Array.isArray(config.samples)
    ? config.samples.map((sample, index) => parseConfigSample(sample, index))
    : [];
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
    checkerType,
    checkerLanguage,
    checkerSourceCode: null,
    compareMode: resolveCompareMode(config),
    problemSettings,
    samples,
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
    parsed = JSON.parse(normalizePackageText(configEntry.getData().toString("utf8")));
  } catch {
    throw new Error("config.json must be valid UTF-8 JSON");
  }

  const config = parseConfig(parsed);
  if (config.checkerType !== "special_judge" || !config.checkerLanguage) {
    return config;
  }

  const checkerEntry = entryByPath.get(checkerSourceFileName(config.checkerLanguage));
  if (!checkerEntry) {
    throw new Error(
      `${checkerSourceFileName(config.checkerLanguage)} is required for special_judge`,
    );
  }

  return {
    ...config,
    checkerSourceCode: normalizePackageText(checkerEntry.getData().toString("utf8")),
  };
}

function casePath(groupName: string, caseName: string, ext: "in" | "out"): string {
  return `tests/${groupName}/${caseName}.${ext}`;
}

function samplePath(caseName: string, ext: "in" | "out"): string {
  return `samples/${caseName}.${ext}`;
}

function buildSampleCases(
  configSamples: ParsedConfigSample[],
  entryByPath: ReadonlyMap<string, AdmZip.IZipEntry>,
  sampleIn: ReadonlySet<string>,
): ProblemPackageSampleCase[] {
  const configuredByName = new Map(configSamples.map((sample) => [sample.name, sample]));
  const orderedNames = [
    ...configSamples.map((sample) => sample.name),
    ...[...sampleIn]
      .filter((name) => !configuredByName.has(name))
      .sort(naturalNameCompare),
  ];

  return orderedNames
    .map((caseName) => {
      if (!sampleIn.has(caseName)) {
        throw new Error(`samples/${caseName}.in/.out is required by config.samples`);
      }
      const inEntry = entryByPath.get(samplePath(caseName, "in"));
      const outEntry = entryByPath.get(samplePath(caseName, "out"));
      if (!inEntry || !outEntry) {
        throw new Error(`samples/${caseName}.in/.out is required`);
      }
      return {
        name: caseName,
        description: configuredByName.get(caseName)?.description ?? "",
        input: normalizePackageText(inEntry.getData().toString("utf8")),
        output: normalizePackageText(outEntry.getData().toString("utf8")),
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
    ...[...allGroupNames].filter((name) => !configByName.has(name)).sort(naturalNameCompare),
  ];

  const groups: ProblemPackageTestGroup[] = [];
  for (const [index, groupName] of orderedGroupNames.entries()) {
    const inSet = testIn.get(groupName) ?? new Set<string>();
    const outSet = testOut.get(groupName) ?? new Set<string>();
    validatePairs(inSet, outSet, `tests/${groupName}`);

    const configured = configByName.get(groupName);
    const discoveredCases = [...inSet].sort(naturalNameCompare);
    const caseNames = configured && configured.tests.length > 0 ? configured.tests : discoveredCases;

    const tests = caseNames.map((caseName) => {
      const inEntry = entryByPath.get(casePath(groupName, caseName, "in"));
      const outEntry = entryByPath.get(casePath(groupName, caseName, "out"));
      if (!inEntry || !outEntry) {
        throw new Error(`tests/${groupName}/${caseName}.in/.out is required by config.groups`);
      }
      return {
        name: caseName,
        input: normalizePackageText(inEntry.getData().toString("utf8")),
        output: normalizePackageText(outEntry.getData().toString("utf8")),
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

  const groupNames = new Set<string>([...testIn.keys(), ...testOut.keys()]);
  if (groupNames.size === 0) {
    throw new Error("tests/<group-name>/*.in and *.out are required");
  }

  const config = parseConfigFromEntry(entryByPath);
  const samples = buildSampleCases(config.samples, entryByPath, sampleIn);
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
      checkerLanguage: config.checkerLanguage,
      compareMode: config.compareMode,
      problem: {
        slug: config.problemSettings.slug ?? null,
        visibility: config.problemSettings.visibility ?? null,
        explanationVisibility: config.problemSettings.explanationVisibility ?? null,
        difficulty:
          config.problemSettings.difficulty === undefined
            ? null
            : config.problemSettings.difficulty,
        testCaseVisibility: config.problemSettings.testCaseVisibility ?? null,
      },
      samples: samples.map((sample) => ({
        name: sample.name,
        description: sample.description,
      })),
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
    checkerType: config.checkerType,
    checkerLanguage: config.checkerLanguage,
    checkerSourceCode: config.checkerSourceCode,
    compareMode: config.compareMode,
    samples,
    groups,
  };
}

interface ProblemPackageArchive {
  fileName: string;
  zipBuffer: Buffer;
  files: AdmZip.IZipEntry[];
  entryByPath: Map<string, AdmZip.IZipEntry>;
  config: ParsedConfig;
  sampleIn: Set<string>;
  sampleOut: Set<string>;
  testIn: Map<string, Set<string>>;
  testOut: Map<string, Set<string>>;
}

function openProblemPackageArchive(
  fileName: string,
  zipBuffer: Buffer,
): ProblemPackageArchive {
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

  const groupNames = new Set<string>([...testIn.keys(), ...testOut.keys()]);
  if (groupNames.size === 0) {
    throw new Error("tests/<group-name>/*.in and *.out are required");
  }

  return {
    fileName,
    zipBuffer,
    files,
    entryByPath,
    config: parseConfigFromEntry(entryByPath),
    sampleIn,
    sampleOut,
    testIn,
    testOut,
  };
}

function buildTestGroupDraftManifest(
  config: ParsedConfig,
  testIn: ReadonlyMap<string, Set<string>>,
  testOut: ReadonlyMap<string, Set<string>>,
): {
  groups: ProblemPackageEditorGroup[];
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
    ...[...allGroupNames].filter((name) => !configByName.has(name)).sort(naturalNameCompare),
  ];

  const groups: ProblemPackageEditorGroup[] = [];
  for (const [groupIndex, groupName] of orderedGroupNames.entries()) {
    const inSet = testIn.get(groupName) ?? new Set<string>();
    const outSet = testOut.get(groupName) ?? new Set<string>();
    validatePairs(inSet, outSet, `tests/${groupName}`);

    const configured = configByName.get(groupName);
    const discoveredCases = [...inSet].sort(naturalNameCompare);
    const caseNames = configured && configured.tests.length > 0 ? configured.tests : discoveredCases;

    groups.push({
      id: `group-${groupIndex + 1}`,
      name: groupName,
      score: config.scoringType === "sum_of_groups" ? configured?.score ?? 0 : null,
      tests: caseNames.map((caseName, caseIndex) => ({
        id: `group-${groupIndex + 1}-case-${caseIndex + 1}`,
        name: caseName,
        input: "",
        output: "",
        isLoaded: false,
      })),
    });
  }

  return { groups, warnings };
}

export function buildEditorDraftManifestFromZip(
  fileName: string,
  zipBuffer: Buffer,
): ProblemPackageEditorDraft {
  const archive = openProblemPackageArchive(fileName, zipBuffer);
  const samples = buildSampleCases(archive.config.samples, archive.entryByPath, archive.sampleIn).map(
    (sample, sampleIndex): ProblemPackageEditorSampleCase => ({
      id: `sample-${sampleIndex + 1}`,
      name: sample.name,
      description: sample.description,
      input: sample.input,
      output: sample.output,
    }),
  );
  const { groups, warnings: groupWarnings } = buildTestGroupDraftManifest(
    archive.config,
    archive.testIn,
    archive.testOut,
  );

  return {
    sourceLabel: fileName,
    checkerType: archive.config.checkerType,
    checkerLanguage: archive.config.checkerLanguage ?? "python",
    checkerSourceCode: archive.config.checkerSourceCode ?? "",
    compareMode: archive.config.compareMode,
    zipSizeBytes: zipBuffer.byteLength,
    fileCount: archive.files.length,
    isPartial: true,
    samples,
    warnings: [...archive.config.warnings, ...groupWarnings],
    groups,
  };
}

export function inspectProblemPackageManifestFromZip(
  fileName: string,
  zipBuffer: Buffer,
): ProblemPackageManifest {
  const archive = openProblemPackageArchive(fileName, zipBuffer);
  const sampleCases = buildSampleCases(
    archive.config.samples,
    archive.entryByPath,
    archive.sampleIn,
  );
  const { groups, warnings: groupWarnings } = buildTestGroupDraftManifest(
    archive.config,
    archive.testIn,
    archive.testOut,
  );
  const warnings = [...archive.config.warnings, ...groupWarnings];
  const totalTestPairs = groups.reduce((acc, group) => acc + group.tests.length, 0);
  const testsByGroupName = new Map(groups.map((group) => [group.name, group.tests.length]));

  return {
    validation: {
      fileName,
      zipSizeBytes: zipBuffer.byteLength,
      fileCount: archive.files.length,
      samplePairs: sampleCases.length,
      testGroupCount: groups.length,
      totalTestPairs,
      config: {
        timeLimitMs: archive.config.timeLimitMs,
        memoryLimitMb: archive.config.memoryLimitMb,
        scoringType: archive.config.scoringType,
        checkerType: archive.config.checkerType,
        checkerLanguage: archive.config.checkerLanguage,
        compareMode: archive.config.compareMode,
        problem: {
          slug: archive.config.problemSettings.slug ?? null,
          visibility: archive.config.problemSettings.visibility ?? null,
          explanationVisibility: archive.config.problemSettings.explanationVisibility ?? null,
          difficulty:
            archive.config.problemSettings.difficulty === undefined
              ? null
              : archive.config.problemSettings.difficulty,
          testCaseVisibility: archive.config.problemSettings.testCaseVisibility ?? null,
        },
        samples: sampleCases.map((sample) => ({
          name: sample.name,
          description: sample.description,
        })),
        groups: groups.map((group) => ({
          name: group.name,
          score: group.score,
          tests: testsByGroupName.get(group.name) ?? 0,
        })),
      },
      warnings,
    },
    scoringType: archive.config.scoringType,
    checkerType: archive.config.checkerType,
    checkerLanguage: archive.config.checkerLanguage,
    compareMode: archive.config.compareMode,
    sampleCases,
  };
}

export function readProblemPackageTestCaseFromZip(
  fileName: string,
  zipBuffer: Buffer,
  params: {
    groupName: string;
    caseName: string;
  },
): ProblemPackageTestCase {
  const archive = openProblemPackageArchive(fileName, zipBuffer);
  const normalizedGroupName = params.groupName.trim();
  const normalizedCaseName = params.caseName.trim();
  if (!normalizedGroupName || !normalizedCaseName) {
    throw new Error("groupName and caseName are required");
  }

  const inEntry = archive.entryByPath.get(casePath(normalizedGroupName, normalizedCaseName, "in"));
  const outEntry = archive.entryByPath.get(casePath(normalizedGroupName, normalizedCaseName, "out"));
  if (!inEntry || !outEntry) {
    throw new Error(`tests/${normalizedGroupName}/${normalizedCaseName}.in/.out is required`);
  }

  return {
    name: normalizedCaseName,
    input: normalizePackageText(inEntry.getData().toString("utf8")),
    output: normalizePackageText(outEntry.getData().toString("utf8")),
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
    visibility?: Visibility;
    explanationVisibility?: ExplanationVisibility;
    difficulty?: number | null;
    testCaseVisibility?: TestCaseVisibility;
    slug?: string;
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
  return normalizePackageText(entry.getData().toString("utf8"));
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
    checkerType: extracted.checkerType,
    checkerLanguage: extracted.checkerLanguage ?? "python",
    checkerSourceCode: extracted.checkerSourceCode ?? "",
    compareMode: extracted.compareMode,
    zipSizeBytes: extracted.validation.zipSizeBytes,
    fileCount: extracted.validation.fileCount,
    isPartial: false,
    samples: extracted.samples.map((sample, sampleIndex): ProblemPackageEditorSampleCase => ({
      id: `sample-${sampleIndex + 1}`,
      name: sample.name,
      description: sample.description,
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
        isLoaded: true,
      })),
    })),
  };
}

export function buildProblemPackageFromEditorDraft(input: {
  sourceLabel?: string;
  checkerType?: ProblemPackageCheckerType;
  checkerLanguage?: Language;
  checkerSourceCode?: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  compareMode?: ProblemPackageCompareMode;
  zipSizeBytes?: number;
  fileCount?: number;
  samples?: ProblemPackageEditorSampleCase[];
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
        input: normalizePackageText(test.input),
        output: normalizePackageText(test.output),
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
  const checkerType = input.checkerType ?? "exact";
  const checkerLanguage = checkerType === "special_judge" ? input.checkerLanguage ?? "python" : null;
  const checkerSourceCode =
    checkerType === "special_judge"
      ? normalizePackageText((input.checkerSourceCode ?? "").trim())
      : null;
  if (checkerType === "special_judge" && !checkerSourceCode) {
    throw new Error("checker source code is required for special judge");
  }
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
          description:
            typeof sample.description === "string"
              ? normalizePackageText(sample.description)
              : "",
          input: normalizePackageText(sample.input),
          output: normalizePackageText(sample.output),
        };
      })
    : [];

  const compareMode = input.compareMode ?? "exact";
  const fileName = input.sourceLabel?.trim() || "manual-package";
  const zipSizeBytes = parseNonNegativeInteger(input.zipSizeBytes ?? 0, "zipSizeBytes");
  const totalTestPairs = groups.reduce((acc, group) => acc + group.tests.length, 0);
  const computedFileCount = 2 + (samples.length + totalTestPairs) * 2 + (checkerType === "special_judge" ? 1 : 0);
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
        checkerType,
        checkerLanguage,
        compareMode,
        problem: {
          slug: null,
          visibility: null,
          explanationVisibility: null,
          difficulty: null,
          testCaseVisibility: null,
        },
        samples: samples.map((sample) => ({
          name: sample.name,
          description: sample.description,
        })),
        groups: groups.map((group) => ({
          name: group.name,
          score: scoringType === "sum_of_groups" ? group.score : null,
          tests: group.tests.length,
        })),
      },
      warnings,
    },
    scoringType,
    checkerType,
    checkerLanguage,
    checkerSourceCode,
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
      visibility: extracted.validation.config.problem.visibility ?? undefined,
      explanationVisibility:
        extracted.validation.config.problem.explanationVisibility ?? undefined,
      difficulty: extracted.validation.config.problem.difficulty,
      testCaseVisibility:
        extracted.validation.config.problem.testCaseVisibility ?? undefined,
      slug: extracted.validation.config.problem.slug ?? undefined,
    }),
    draft: buildEditorDraftFromExtracted(extracted),
  };
}

export function buildProblemStatementMarkdown(input: {
  title: string;
  statementMarkdown: string;
  inputDescription: string;
  outputDescription: string;
  constraintsMarkdown: string;
  explanationMarkdown: string;
}): string {
  const parts = [
    `# ${input.title.trim() || "Untitled Problem"}`,
    "",
    input.statementMarkdown.trim(),
    "",
    "## Input",
    input.inputDescription.trim(),
    "",
    "## Output",
    input.outputDescription.trim(),
    "",
    "## Constraints",
    input.constraintsMarkdown.trim(),
  ];

  if (input.explanationMarkdown.trim()) {
    parts.push("", "## Explanation", input.explanationMarkdown.trim());
  }

  return `${parts.join("\n")}\n`;
}

export function buildProblemPackageZip(input: {
  title: string;
  slug: string;
  visibility: Visibility;
  explanationVisibility: ExplanationVisibility;
  difficulty: number | null;
  testCaseVisibility: TestCaseVisibility;
  statementMarkdown: string;
  inputDescription: string;
  outputDescription: string;
  constraintsMarkdown: string;
  explanationMarkdown: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  draft: ProblemPackageEditorDraft;
}): Buffer {
  const extracted = buildProblemPackageFromEditorDraft({
    sourceLabel: input.draft.sourceLabel,
    checkerType: input.draft.checkerType,
    checkerLanguage: input.draft.checkerLanguage,
    checkerSourceCode: input.draft.checkerSourceCode,
    compareMode: input.draft.compareMode,
    zipSizeBytes: input.draft.zipSizeBytes,
    fileCount: input.draft.fileCount,
    samples: input.draft.samples,
    warnings: input.draft.warnings,
    timeLimitMs: input.timeLimitMs,
    memoryLimitMb: input.memoryLimitMb,
    groups: input.draft.groups,
  });

  const config = {
    timeLimitMs: input.timeLimitMs,
    memoryLimitMb: input.memoryLimitMb,
    scoringType: extracted.scoringType,
    checkerType: extracted.checkerType,
    checkerLanguage: extracted.checkerLanguage,
    compareMode: extracted.compareMode,
    problem: {
      slug: input.slug,
      visibility: input.visibility,
      explanationVisibility: input.explanationVisibility,
      difficulty: input.difficulty,
      testCaseVisibility: input.testCaseVisibility,
    },
    samples: extracted.samples.map((sample) => ({
      name: sample.name,
      description: sample.description,
    })),
    groups: extracted.groups.map((group) =>
      extracted.scoringType === "sum_of_groups"
        ? {
            name: group.name,
            score: group.score,
          }
        : group.name,
    ),
  };

  const zip = new AdmZip();
  zip.addFile(
    "statement.md",
    Buffer.from(
      buildProblemStatementMarkdown({
        title: input.title,
        statementMarkdown: input.statementMarkdown,
        inputDescription: input.inputDescription,
        outputDescription: input.outputDescription,
        constraintsMarkdown: input.constraintsMarkdown,
        explanationMarkdown: input.explanationMarkdown,
      }),
      "utf8",
    ),
  );
  zip.addFile("config.json", Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"));

  for (const sample of extracted.samples) {
    zip.addFile(`samples/${sample.name}.in`, Buffer.from(sample.input, "utf8"));
    zip.addFile(`samples/${sample.name}.out`, Buffer.from(sample.output, "utf8"));
  }

  for (const group of extracted.groups) {
    for (const testCase of group.tests) {
      zip.addFile(`tests/${group.name}/${testCase.name}.in`, Buffer.from(testCase.input, "utf8"));
      zip.addFile(`tests/${group.name}/${testCase.name}.out`, Buffer.from(testCase.output, "utf8"));
    }
  }

  if (
    extracted.checkerType === "special_judge" &&
    extracted.checkerLanguage &&
    extracted.checkerSourceCode
  ) {
    zip.addFile(
      checkerSourceFileName(extracted.checkerLanguage),
      Buffer.from(extracted.checkerSourceCode, "utf8"),
    );
  }

  return zip.toBuffer();
}

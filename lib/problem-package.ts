import AdmZip from "adm-zip";
import { Language } from "@/lib/types";

const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 1000;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;

const ALLOWED_LANGUAGES: ReadonlySet<Language> = new Set([
  "cpp",
  "python",
  "java",
  "javascript",
]);

export type ProblemPackageScoringType = "binary" | "sum_of_groups";
export type ProblemPackageCompareMode = "exact" | "ignore_trailing_spaces";

interface ConfigGroupSummary {
  name: string;
  score: number;
  tests: number;
}

interface ConfigSummary {
  timeLimitMs: number;
  memoryLimitMb: number;
  scoringType: ProblemPackageScoringType;
  checkerType: "exact";
  compareMode: ProblemPackageCompareMode;
  languages: Language[];
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
  groups: ProblemPackageTestGroup[];
}

interface ParsedConfigGroup {
  name: string;
  score: number;
  tests: string[];
}

interface ParsedConfig {
  timeLimitMs: number;
  memoryLimitMb: number;
  scoringType: ProblemPackageScoringType;
  checkerType: "exact";
  compareMode: ProblemPackageCompareMode;
  languages: Language[];
  groups: ParsedConfigGroup[];
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

function parseScoringType(raw: unknown): ProblemPackageScoringType {
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
  if (!value || typeof value !== "object") {
    throw new Error(`config.groups[${index}] must be an object`);
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) {
    throw new Error(`config.groups[${index}].name must be a non-empty string`);
  }
  if (typeof record.score !== "number" || !Number.isFinite(record.score) || record.score < 0) {
    throw new Error(`config.groups[${index}].score must be a non-negative number`);
  }
  if (!Array.isArray(record.tests)) {
    throw new Error(`config.groups[${index}].tests must be an array`);
  }

  const tests = record.tests.map((item, testIndex) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`config.groups[${index}].tests[${testIndex}] must be a non-empty string`);
    }
    return item.trim();
  });

  return {
    name: record.name.trim(),
    score: record.score,
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

  if (!Array.isArray(config.languages) || config.languages.length === 0) {
    throw new Error("config.languages must be a non-empty array");
  }

  const languages = config.languages.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`config.languages[${index}] must be a string`);
    }
    if (!ALLOWED_LANGUAGES.has(item as Language)) {
      throw new Error(`config.languages[${index}] is not supported: ${item}`);
    }
    return item as Language;
  });

  if (!Array.isArray(config.groups) || config.groups.length === 0) {
    throw new Error("config.groups must be a non-empty array");
  }

  const groups = config.groups.map((group, index) => parseConfigGroup(group, index));

  return {
    timeLimitMs: parsePositiveNumber(config.timeLimitMs, "config.timeLimitMs"),
    memoryLimitMb: parsePositiveNumber(config.memoryLimitMb, "config.memoryLimitMb"),
    scoringType: parseScoringType(config.scoringType),
    checkerType: "exact",
    compareMode: resolveCompareMode(config),
    languages,
    groups,
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

  const groupNames = new Set<string>([...testIn.keys(), ...testOut.keys()]);
  if (groupNames.size === 0) {
    throw new Error("tests/<group-name>/*.in and *.out are required");
  }

  const config = parseConfigFromEntry(entryByPath);
  const { groups, warnings } = buildTestGroups(config, entryByPath, testIn, testOut);
  const totalTestPairs = groups.reduce((acc, group) => acc + group.tests.length, 0);

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
      languages: config.languages,
      groups: config.groups.map((group) => ({
        name: group.name,
        score: group.score,
        tests: group.tests.length,
      })),
    },
    warnings,
  };

  return {
    validation,
    scoringType: config.scoringType,
    compareMode: config.compareMode,
    groups,
  };
}

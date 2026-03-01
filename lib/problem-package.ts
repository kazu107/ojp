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

interface ConfigGroupSummary {
  name: string;
  score: number;
  tests: number;
}

interface ConfigSummary {
  timeLimitMs: number;
  memoryLimitMb: number;
  scoringType: string;
  checkerType: "exact";
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

function parseConfigGroup(value: unknown, index: number): ConfigGroupSummary {
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

  return {
    name: record.name.trim(),
    score: record.score,
    tests: record.tests.length,
  };
}

function parseConfig(configJson: unknown): ConfigSummary {
  if (!configJson || typeof configJson !== "object") {
    throw new Error("config.json must be a JSON object");
  }

  const config = configJson as Record<string, unknown>;
  if (typeof config.scoringType !== "string" || !config.scoringType.trim()) {
    throw new Error("config.scoringType must be a non-empty string");
  }

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
    scoringType: config.scoringType.trim(),
    checkerType: "exact",
    languages,
    groups,
  };
}

function parseConfigFromEntry(
  entryByPath: ReadonlyMap<string, AdmZip.IZipEntry>,
): ConfigSummary {
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

export function validateProblemPackage(
  fileName: string,
  zipBuffer: Buffer,
): ProblemPackageValidationResult {
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

  for (const path of entryByPath.keys()) {
    const sampleMatch = /^samples\/(.+)\.(in|out)$/.exec(path);
    if (sampleMatch) {
      const [, baseName, extension] = sampleMatch;
      if (extension === "in") {
        sampleIn.add(baseName);
      } else {
        sampleOut.add(baseName);
      }
      continue;
    }

    const testMatch = /^tests\/([^/]+)\/(.+)\.(in|out)$/.exec(path);
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

  let totalTestPairs = 0;
  for (const groupName of [...groupNames].sort((a, b) => a.localeCompare(b))) {
    const inSet = testIn.get(groupName) ?? new Set<string>();
    const outSet = testOut.get(groupName) ?? new Set<string>();
    validatePairs(inSet, outSet, `tests/${groupName}`);
    totalTestPairs += inSet.size;
  }

  const config = parseConfigFromEntry(entryByPath);

  const warnings: string[] = [];
  const testGroups = new Set<string>(groupNames);
  const configGroups = new Set(config.groups.map((group) => group.name));

  for (const groupName of configGroups) {
    if (!testGroups.has(groupName)) {
      warnings.push(`config.groups has '${groupName}', but tests/${groupName} is missing.`);
    }
  }
  for (const groupName of testGroups) {
    if (!configGroups.has(groupName)) {
      warnings.push(`tests/${groupName} exists, but config.groups does not include it.`);
    }
  }

  return {
    fileName,
    zipSizeBytes: zipBuffer.byteLength,
    fileCount: files.length,
    samplePairs: sampleIn.size,
    testGroupCount: groupNames.size,
    totalTestPairs,
    config,
    warnings,
  };
}

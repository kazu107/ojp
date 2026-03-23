import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import * as yauzl from "yauzl";
import {
  checkerSourceFileName,
  hasPathTraversal,
  normalizePath,
  parseConfig,
  type ProblemPackageManifest,
  type ProblemPackageSampleCase,
  type ProblemPackageTestCase,
  validatePairs,
} from "@/lib/problem-package";
import { getProblemPackageZipStream, type ProblemPackageStorageRef } from "@/lib/problem-package-storage";

const MAX_ZIP_BYTES = 256 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 4000;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;

interface LazyGroupInfo {
  name: string;
  score: number;
  orderIndex: number;
  caseNames: string[];
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

export interface LazyProblemPackageSource {
  manifest: ProblemPackageManifest;
  checkerSourceCode: string | null;
  groups: LazyGroupInfo[];
  readTestCase: (groupName: string, caseName: string) => Promise<ProblemPackageTestCase>;
  materializeTestCaseFiles: (
    groupName: string,
    caseName: string,
    targetDir: string,
  ) => Promise<{
    name: string;
    inputPath: string;
    outputPath: string;
  }>;
  cleanup: () => Promise<void>;
}

function pushToSetMap(target: Map<string, Set<string>>, key: string, value: string): void {
  const current = target.get(key) ?? new Set<string>();
  current.add(value);
  target.set(key, current);
}

function readEntryString(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<string> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`failed to open ${entry.fileName}`));
        return;
      }

      let text = "";
      stream.on("data", (chunk: Buffer | string) => {
        text += chunk.toString();
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(normalizePackageText(text)));
    });
  });
}

function writeEntryToFile(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  filePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`failed to open ${entry.fileName}`));
        return;
      }

      pipeline(stream, createWriteStream(filePath)).then(() => resolve(), reject);
    });
  });
}

function openZipFile(zipFilePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipFilePath,
      {
        lazyEntries: true,
        autoClose: false,
      },
      (error, zipFile) => {
        if (error || !zipFile) {
          reject(error ?? new Error("failed to open zip"));
          return;
        }
        resolve(zipFile);
      },
    );
  });
}

async function streamStorageRefToTempFile(input: {
  ref: ProblemPackageStorageRef;
  fileName: string;
}): Promise<{
  zipFilePath: string;
  cleanupTempDir: () => Promise<void>;
}> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ojp-package-"));
  const zipFilePath = path.join(tempDir, input.fileName);
  await mkdir(path.dirname(zipFilePath), { recursive: true });

  const body = await getProblemPackageZipStream(input.ref);
  await pipeline(
    Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>),
    createWriteStream(zipFilePath),
  );

  return {
    zipFilePath,
    cleanupTempDir: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

export async function createLazyProblemPackageSourceFromStorageRef(input: {
  ref: ProblemPackageStorageRef;
  fileName: string;
}): Promise<LazyProblemPackageSource> {
  if (input.ref.sizeBytes > MAX_ZIP_BYTES) {
    throw new Error(`zip size exceeds limit (${MAX_ZIP_BYTES} bytes)`);
  }

  const { zipFilePath, cleanupTempDir } = await streamStorageRefToTempFile({
    ref: input.ref,
    fileName: input.fileName,
  });
  const zipFile = await openZipFile(zipFilePath);

  try {
    const files: yauzl.Entry[] = [];
    const entryByPath = new Map<string, yauzl.Entry>();
    const sampleIn = new Set<string>();
    const sampleOut = new Set<string>();
    const testIn = new Map<string, Set<string>>();
    const testOut = new Map<string, Set<string>>();

    let expandedBytes = 0;

    await new Promise<void>((resolve, reject) => {
      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry();
          return;
        }

        const normalizedPath = normalizePath(entry.fileName);
        if (hasPathTraversal(normalizedPath)) {
          reject(new Error(`unsafe path is not allowed: ${entry.fileName}`));
          return;
        }
        if (entryByPath.has(normalizedPath)) {
          reject(new Error(`duplicate file path: ${normalizedPath}`));
          return;
        }
        if (entry.uncompressedSize > MAX_SINGLE_FILE_BYTES) {
          reject(
            new Error(
              `single file size exceeds limit (${MAX_SINGLE_FILE_BYTES} bytes): ${normalizedPath}`,
            ),
          );
          return;
        }

        expandedBytes += entry.uncompressedSize;
        if (expandedBytes > MAX_EXPANDED_BYTES) {
          reject(new Error(`expanded total size exceeds limit (${MAX_EXPANDED_BYTES} bytes)`));
          return;
        }

        files.push(entry);
        if (files.length > MAX_FILES) {
          reject(new Error(`file count exceeds limit (${MAX_FILES})`));
          return;
        }
        entryByPath.set(normalizedPath, entry);

        const sampleMatch = /^samples\/(.+)\.(in|out)$/.exec(normalizedPath);
        if (sampleMatch) {
          const [, baseName, extension] = sampleMatch;
          if (extension === "in") {
            sampleIn.add(baseName);
          } else {
            sampleOut.add(baseName);
          }
          zipFile.readEntry();
          return;
        }

        const testMatch = /^tests\/([^/]+)\/(.+)\.(in|out)$/.exec(normalizedPath);
        if (testMatch) {
          const [, groupName, caseName, extension] = testMatch;
          if (extension === "in") {
            pushToSetMap(testIn, groupName, caseName);
          } else {
            pushToSetMap(testOut, groupName, caseName);
          }
        }

        zipFile.readEntry();
      });
      zipFile.on("end", () => resolve());
      zipFile.on("error", reject);
    });

    if (!entryByPath.has("statement.md")) {
      throw new Error("statement.md is required");
    }
    const configEntry = entryByPath.get("config.json");
    if (!configEntry) {
      throw new Error("config.json is required");
    }

    validatePairs(sampleIn, sampleOut, "samples");
    const allGroupNames = new Set<string>([...testIn.keys(), ...testOut.keys()]);
    if (allGroupNames.size === 0) {
      throw new Error("tests/<group-name>/*.in and *.out are required");
    }

    const config = parseConfig(JSON.parse(await readEntryString(zipFile, configEntry)) as unknown);

    const configuredSampleByName = new Map(config.samples.map((sample) => [sample.name, sample]));
    const orderedSampleNames = [
      ...config.samples.map((sample) => sample.name),
      ...[...sampleIn].filter((name) => !configuredSampleByName.has(name)).sort(naturalNameCompare),
    ];
    const sampleCases: ProblemPackageSampleCase[] = [];
    for (const caseName of orderedSampleNames) {
      if (!sampleIn.has(caseName)) {
        throw new Error(`samples/${caseName}.in/.out is required by config.samples`);
      }
      const inEntry = entryByPath.get(`samples/${caseName}.in`);
      const outEntry = entryByPath.get(`samples/${caseName}.out`);
      if (!inEntry || !outEntry) {
        throw new Error(`samples/${caseName}.in/.out is required`);
      }
      sampleCases.push({
        name: caseName,
        description: configuredSampleByName.get(caseName)?.description ?? "",
        input: await readEntryString(zipFile, inEntry),
        output: await readEntryString(zipFile, outEntry),
      });
    }

    const warnings: string[] = [...config.warnings];
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

    const groups: LazyGroupInfo[] = [];
    for (const [index, groupName] of orderedGroupNames.entries()) {
      const inSet = testIn.get(groupName) ?? new Set<string>();
      const outSet = testOut.get(groupName) ?? new Set<string>();
      validatePairs(inSet, outSet, `tests/${groupName}`);
      const configured = configByName.get(groupName);
      const discoveredCases = [...inSet].sort(naturalNameCompare);
      const caseNames = configured && configured.tests.length > 0 ? configured.tests : discoveredCases;
      groups.push({
        name: groupName,
        score: config.scoringType === "sum_of_groups" ? configured?.score ?? 0 : 0,
        orderIndex: index,
        caseNames,
      });
    }

    const testsByGroupName = new Map(groups.map((group) => [group.name, group.caseNames.length]));
    let checkerSourceCode: string | null = null;
    if (config.checkerType === "special_judge" && config.checkerLanguage) {
      const checkerEntry = entryByPath.get(checkerSourceFileName(config.checkerLanguage));
      if (!checkerEntry) {
        throw new Error(`${checkerSourceFileName(config.checkerLanguage)} is required for special_judge`);
      }
      checkerSourceCode = await readEntryString(zipFile, checkerEntry);
    }

    return {
      manifest: {
        validation: {
          fileName: input.fileName,
          zipSizeBytes: input.ref.sizeBytes,
          fileCount: files.length,
          samplePairs: sampleCases.length,
          testGroupCount: groups.length,
          totalTestPairs: groups.reduce((acc, group) => acc + group.caseNames.length, 0),
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
        scoringType: config.scoringType,
        checkerType: config.checkerType,
        checkerLanguage: config.checkerLanguage,
        compareMode: config.compareMode,
        sampleCases,
      },
      checkerSourceCode,
      groups,
      readTestCase: async (groupName: string, caseName: string) => {
        const inEntry = entryByPath.get(`tests/${groupName}/${caseName}.in`);
        const outEntry = entryByPath.get(`tests/${groupName}/${caseName}.out`);
        if (!inEntry || !outEntry) {
          throw new Error(`tests/${groupName}/${caseName}.in/.out is required`);
        }
        return {
          name: caseName,
          input: await readEntryString(zipFile, inEntry),
          output: await readEntryString(zipFile, outEntry),
        };
      },
      materializeTestCaseFiles: async (groupName: string, caseName: string, targetDir: string) => {
        const inEntry = entryByPath.get(`tests/${groupName}/${caseName}.in`);
        const outEntry = entryByPath.get(`tests/${groupName}/${caseName}.out`);
        if (!inEntry || !outEntry) {
          throw new Error(`tests/${groupName}/${caseName}.in/.out is required`);
        }

        await mkdir(targetDir, { recursive: true });
        const inputPath = path.join(targetDir, "input.txt");
        const outputPath = path.join(targetDir, "answer.txt");
        await writeEntryToFile(zipFile, inEntry, inputPath);
        await writeEntryToFile(zipFile, outEntry, outputPath);

        return {
          name: caseName,
          inputPath,
          outputPath,
        };
      },
      cleanup: async () => {
        try {
          zipFile.close();
        } catch {
          // noop
        }
        await cleanupTempDir();
      },
    };
  } catch (error) {
    try {
      zipFile.close();
    } catch {
      // noop
    }
    await cleanupTempDir();
    throw error;
  }
}

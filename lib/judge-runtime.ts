import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  assertJudgeSandboxReady,
  getJudgeResourceLimits,
  runJudgeCommand,
  removeJudgeDirectory,
  type JudgeCommandOptions,
  type JudgeCommandResult,
} from "./judge-process";
import type {
  ProblemPackageExtracted,
  ProblemPackageScoringType,
  ProblemPackageCompareMode,
} from "@/lib/problem-package";
import type { LazyProblemPackageSource } from "@/lib/problem-package-lazy";
import type { Language, Submission, SubmissionStatus } from "@/lib/types";
import {
  isAcceptedSubmissionStatus,
  pickHighestPriorityVerdict,
} from "@/lib/submission-status";

type CommandResult = JudgeCommandResult;

interface CommandTemplate {
  commands: string[];
  args: string[];
}

interface JudgeResult {
  status: SubmissionStatus;
  score: number;
  totalTimeMs: number;
  peakMemoryKb: number;
  testResults: Submission["testResults"];
}

async function runWithFallback(
  template: CommandTemplate,
  options: JudgeCommandOptions,
): Promise<{ result: CommandResult; usedCommand: string }> {
  let lastResult: CommandResult | null = null;
  for (const command of template.commands) {
    const result = await runJudgeCommand(command, template.args, options);
    if (result.spawnErrorCode !== "ENOENT") {
      return { result, usedCommand: command };
    }
    lastResult = result;
  }
  return {
    result:
      lastResult ??
      ({
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: false,
        memoryLimitExceeded: false,
        outputLimitExceeded: false,
        processLimitExceeded: false,
        workspaceLimitExceeded: false,
        durationMs: 0,
        cpuDurationMs: 0,
        wallDurationMs: 0,
        memoryKb: 0,
        stdoutFilePath: options.stdoutFilePath ?? null,
        spawnErrorCode: "ENOENT",
      } as CommandResult),
    usedCommand: template.commands[0] ?? "",
  };
}

function resolveLanguageCommands(language: Language, baseName = "Main", memoryLimitMb = 512): {
  sourceFileName: string;
  compile?: CommandTemplate & { timeoutMs: number };
  execute: CommandTemplate;
} {
  if (language === "cpp") {
    return {
      sourceFileName: `${baseName}.cpp`,
      compile: {
        commands: ["g++", "clang++"],
        args: [`${baseName}.cpp`, "-O2", "-std=gnu++17", "-o", "main"],
        timeoutMs: 20_000,
      },
      execute: {
        commands: [process.platform === "win32" ? "main.exe" : "./main"],
        args: [],
      },
    };
  }

  if (language === "python") {
    return {
      sourceFileName: `${baseName}.py`,
      compile: {
        commands: ["python3", "python"],
        args: ["-m", "py_compile", `${baseName}.py`],
        timeoutMs: 10_000,
      },
      execute: {
        commands: ["python3", "python"],
        args: [`${baseName}.py`],
      },
    };
  }

  if (language === "java") {
    return {
      sourceFileName: `${baseName}.java`,
      compile: {
        commands: ["javac"],
        args: ["-J-XX:ActiveProcessorCount=1", `${baseName}.java`],
        timeoutMs: 20_000,
      },
      execute: {
        commands: ["java"],
        args: ["-XX:ActiveProcessorCount=1", `-Xmx${Math.max(8, Math.floor(memoryLimitMb))}m`, baseName],
      },
    };
  }

  return {
    sourceFileName: `${baseName}.js`,
    compile: {
      commands: ["node"],
      args: ["--check", `${baseName}.js`],
      timeoutMs: 10_000,
    },
    execute: {
      commands: ["node"],
      args: [`--max-old-space-size=${Math.max(8, Math.floor(memoryLimitMb))}`, `${baseName}.js`],
    },
  };
}

function scoreFromGroups(
  scoringType: ProblemPackageScoringType,
  judgedGroupStates: Array<{ score: number; accepted: boolean }>,
): number {
  if (scoringType === "binary") {
    return judgedGroupStates.every((state) => state.accepted) ? 100 : 0;
  }
  return judgedGroupStates.reduce((acc, state) => (state.accepted ? acc + state.score : acc), 0);
}

function overallVerdict(results: Submission["testResults"]): SubmissionStatus {
  return pickHighestPriorityVerdict(results.map((result) => result.verdict));
}

async function compileProgram(
  cwd: string,
  commands: ReturnType<typeof resolveLanguageCommands>,
): Promise<
  | { ok: true }
  | {
      ok: false;
      verdict: SubmissionStatus;
      timeMs: number;
      message: string;
    }
> {
  if (!commands.compile) {
    return { ok: true };
  }

  const compiled = await runWithFallback(
    {
      commands: commands.compile.commands,
      args: commands.compile.args,
    },
    {
      cwd,
      stdin: "",
      timeoutMs: commands.compile.timeoutMs,
      captureMemory: false,
      memoryLimitMb: getJudgeResourceLimits().compilerMemoryMb,
    },
  );
  const compileResult = compiled.result;
  if (compileResult.spawnErrorCode === "ENOENT") {
    return {
      ok: false,
      verdict: "internal_error",
      timeMs: 0,
      message: `toolchain not found: ${commands.compile.commands.join(" / ")}`,
    };
  }
  if (compileResult.timedOut) {
    return {
      ok: false,
      verdict: "compilation_error",
      timeMs: compileResult.durationMs,
      message: "compile timeout",
    };
  }
  if (compileResult.memoryLimitExceeded || compileResult.outputLimitExceeded ||
      compileResult.processLimitExceeded || compileResult.workspaceLimitExceeded) {
    return {
      ok: false,
      verdict: "compilation_error",
      timeMs: compileResult.durationMs,
      message: compileResult.memoryLimitExceeded
        ? "compiler memory limit exceeded"
        : "compiler resource limit exceeded",
    };
  }
  if (compileResult.exitCode !== 0) {
    return {
      ok: false,
      verdict: "compilation_error",
      timeMs: compileResult.durationMs,
      message: compileResult.stderr || "compile failed",
    };
  }
  return { ok: true };
}

async function runSpecialJudgeCase(input: {
  checkerWorkspace: string;
  checkerRuntime: CommandTemplate;
  inputPath: string;
  answerPath: string;
  contestantOutputPath: string;
}): Promise<{
  verdict: SubmissionStatus;
  message: string;
}> {
  const checked = await runWithFallback(
    {
      commands: input.checkerRuntime.commands,
      args: [...input.checkerRuntime.args, input.inputPath, input.answerPath, input.contestantOutputPath],
    },
    {
      cwd: input.checkerWorkspace,
      stdin: "",
      timeoutMs: 10_000,
      captureMemory: true,
      memoryLimitMb: getJudgeResourceLimits().checkerMemoryMb,
      readOnlyFiles: [
        { source: input.inputPath, destination: "/cases/input.txt" },
        { source: input.answerPath, destination: "/cases/answer.txt" },
        { source: input.contestantOutputPath, destination: "/cases/output.txt" },
      ],
    },
  );
  const checkResult = checked.result;
  const detail = (checkResult.stdout || checkResult.stderr || "").trim();

  if (checkResult.spawnErrorCode === "ENOENT") {
    return {
      verdict: "internal_error",
      message: `special judge runtime not found: ${input.checkerRuntime.commands.join(" / ")}`,
    };
  }
  if (checkResult.timedOut) {
    return {
      verdict: "internal_error",
      message: "special judge timeout",
    };
  }
  if (checkResult.memoryLimitExceeded || checkResult.outputLimitExceeded ||
      checkResult.processLimitExceeded || checkResult.workspaceLimitExceeded) {
    return { verdict: "internal_error", message: "special judge resource limit exceeded" };
  }
  if (checkResult.exitCode === 0) {
    return {
      verdict: "accepted",
      message: detail || "Accepted",
    };
  }
  if (checkResult.exitCode === 1) {
    return {
      verdict: "wrong_answer",
      message: detail || "Wrong answer.",
    };
  }
  return {
    verdict: "internal_error",
    message: detail || `special judge failed with exit code ${String(checkResult.exitCode)}`,
  };
}

async function materializeInlineTestCaseFiles(input: {
  testCase: { name: string; input: string; output: string };
  targetDir: string;
}): Promise<{
  name: string;
  inputPath: string;
  outputPath: string;
}> {
  await mkdir(input.targetDir, { recursive: true });
  const inputPath = path.join(input.targetDir, "input.txt");
  const outputPath = path.join(input.targetDir, "answer.txt");
  await writeFile(inputPath, input.testCase.input, "utf8");
  await writeFile(outputPath, input.testCase.output, "utf8");
  return {
    name: input.testCase.name,
    inputPath,
    outputPath,
  };
}

async function filesEqualExact(leftPath: string, rightPath: string): Promise<boolean> {
  const left = createReadStream(leftPath);
  const right = createReadStream(rightPath);
  const leftIterator = left[Symbol.asyncIterator]();
  const rightIterator = right[Symbol.asyncIterator]();

  let leftBuffer = Buffer.alloc(0);
  let rightBuffer = Buffer.alloc(0);
  let leftDone = false;
  let rightDone = false;

  try {
    while (true) {
      if (!leftDone && leftBuffer.length === 0) {
        const next = await leftIterator.next();
        leftDone = Boolean(next.done);
        leftBuffer = next.done ? Buffer.alloc(0) : Buffer.from(next.value);
      }
      if (!rightDone && rightBuffer.length === 0) {
        const next = await rightIterator.next();
        rightDone = Boolean(next.done);
        rightBuffer = next.done ? Buffer.alloc(0) : Buffer.from(next.value);
      }

      if (leftDone && rightDone) {
        return leftBuffer.length === 0 && rightBuffer.length === 0;
      }

      const compareLength = Math.min(leftBuffer.length, rightBuffer.length);
      if (compareLength === 0) {
        return false;
      }

      if (!leftBuffer.subarray(0, compareLength).equals(rightBuffer.subarray(0, compareLength))) {
        return false;
      }

      leftBuffer = leftBuffer.subarray(compareLength);
      rightBuffer = rightBuffer.subarray(compareLength);
    }
  } finally {
    left.destroy();
    right.destroy();
  }
}

async function* normalizedLines(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let trailingBlankCount = 0;
  try {
    for await (const rawLine of reader) {
      const line = rawLine.replace(/[ \t]+$/g, "");
      if (line === "") {
        trailingBlankCount += 1;
        continue;
      }
      while (trailingBlankCount > 0) {
        yield "";
        trailingBlankCount -= 1;
      }
      yield line;
    }
  } finally {
    reader.close();
    stream.destroy();
  }
}

async function isOutputAcceptedFiles(
  actualPath: string,
  expectedPath: string,
  compareMode: ProblemPackageCompareMode,
): Promise<boolean> {
  if (compareMode === "exact") {
    return filesEqualExact(actualPath, expectedPath);
  }

  const actual = normalizedLines(actualPath)[Symbol.asyncIterator]();
  const expected = normalizedLines(expectedPath)[Symbol.asyncIterator]();
  try {
    while (true) {
      const [left, right] = await Promise.all([actual.next(), expected.next()]);
      if (left.done || right.done) {
        return Boolean(left.done) && Boolean(right.done);
      }
      if (left.value !== right.value) {
        return false;
      }
    }
  } finally {
    await Promise.all([actual.return(undefined), expected.return(undefined)]);
  }
}

export async function executePackageJudge(input: {
  sourceCode: string;
  language: Language;
  timeLimitMs: number;
  memoryLimitMb: number;
  packageData?: ProblemPackageExtracted;
  packageSource?: LazyProblemPackageSource;
  existingResults?: Submission["testResults"];
  nextTestResultId: () => string;
  onPhaseChange?: (status: "compiling" | "running" | "judging") => void | Promise<void>;
  onTestResult?: (params: {
    result: Submission["testResults"][number];
    totalTimeMs: number;
    peakMemoryKb: number;
  }) => void | Promise<void>;
}): Promise<JudgeResult> {
  const packageMeta = input.packageSource
    ? {
        scoringType: input.packageSource.manifest.scoringType,
        checkerType: input.packageSource.manifest.checkerType,
        checkerLanguage: input.packageSource.manifest.checkerLanguage,
        checkerSourceCode: input.packageSource.checkerSourceCode,
        compareMode: input.packageSource.manifest.compareMode,
        groups: input.packageSource.groups,
      }
    : input.packageData
      ? {
          scoringType: input.packageData.scoringType,
          checkerType: input.packageData.checkerType,
          checkerLanguage: input.packageData.checkerLanguage,
          checkerSourceCode: input.packageData.checkerSourceCode,
          compareMode: input.packageData.compareMode,
          groups: input.packageData.groups.map((group) => ({
            name: group.name,
            score: group.score,
            orderIndex: group.orderIndex,
            caseNames: group.tests.map((testCase) => testCase.name),
          })),
        }
      : null;
  if (!packageMeta) {
    throw new Error("package data is required");
  }

  await assertJudgeSandboxReady();

  const workspace = await mkdtemp(path.join(os.tmpdir(), "ojp-judge-"));
  try {
    const submissionWorkspace = path.join(workspace, "submission");
    await mkdir(submissionWorkspace, { recursive: true });
    const submissionCommands = resolveLanguageCommands(input.language, "Main", input.memoryLimitMb);
    const submissionSourcePath = path.join(submissionWorkspace, submissionCommands.sourceFileName);
    await writeFile(submissionSourcePath, input.sourceCode, "utf8");

    await input.onPhaseChange?.("compiling");
    const submissionCompile = await compileProgram(submissionWorkspace, submissionCommands);
    if (!submissionCompile.ok) {
      return {
        status: submissionCompile.verdict,
        score: 0,
        totalTimeMs: 0,
        peakMemoryKb: 0,
        testResults: [
          {
            id: input.nextTestResultId(),
            groupName: "compile",
            testCaseName: "-",
            verdict: submissionCompile.verdict,
            timeMs: submissionCompile.timeMs,
            memoryKb: 0,
            message: submissionCompile.message,
          },
        ],
      };
    }

    const runtimeTemplate = {
      commands: submissionCommands.execute.commands,
      args: submissionCommands.execute.args,
    };

    let checkerRuntime: CommandTemplate | null = null;
    let checkerWorkspace: string | null = null;
    if (packageMeta.checkerType === "special_judge") {
      if (!packageMeta.checkerLanguage || !packageMeta.checkerSourceCode) {
        return {
          status: "internal_error",
          score: 0,
          totalTimeMs: 0,
          peakMemoryKb: 0,
          testResults: [
            {
              id: input.nextTestResultId(),
              groupName: "checker",
              testCaseName: "-",
              verdict: "internal_error",
              timeMs: 0,
              memoryKb: 0,
              message: "special judge configuration is incomplete",
            },
          ],
        };
      }

      checkerWorkspace = path.join(workspace, "checker");
      await mkdir(checkerWorkspace, { recursive: true });
      const checkerCommands = resolveLanguageCommands(
        packageMeta.checkerLanguage, "Main", getJudgeResourceLimits().checkerMemoryMb,
      );
      const checkerSourcePath = path.join(/* turbopackIgnore: true */ checkerWorkspace, checkerCommands.sourceFileName);
      await writeFile(checkerSourcePath, packageMeta.checkerSourceCode, "utf8");

      const checkerCompile = await compileProgram(checkerWorkspace, checkerCommands);
      if (!checkerCompile.ok) {
        return {
          status: "internal_error",
          score: 0,
          totalTimeMs: 0,
          peakMemoryKb: 0,
          testResults: [
            {
              id: input.nextTestResultId(),
              groupName: "checker",
              testCaseName: "-",
              verdict: "internal_error",
              timeMs: checkerCompile.timeMs,
              memoryKb: 0,
              message: `special judge compile failed: ${checkerCompile.message}`,
            },
          ],
        };
      }

      checkerRuntime = {
        commands: checkerCommands.execute.commands,
        args: checkerCommands.execute.args,
      };
    }

    const existingResults = input.existingResults ?? [];
    const results: Submission["testResults"] = [...existingResults];
    const judgedGroupStates: Array<{ score: number; accepted: boolean }> = [];
    let totalTimeMs = existingResults.reduce((max, result) => Math.max(max, result.timeMs), 0);
    let peakMemoryKb = existingResults.reduce((max, result) => Math.max(max, result.memoryKb), 0);
    let existingIndex = 0;

    for (const group of packageMeta.groups) {
      let groupAccepted = true;
      for (const caseName of group.caseNames) {
        const existing = existingResults[existingIndex];
        if (
          existing &&
          existing.groupName === group.name &&
          existing.testCaseName === caseName
        ) {
          if (!isAcceptedSubmissionStatus(existing.verdict)) {
            groupAccepted = false;
          }
          existingIndex += 1;
          totalTimeMs = Math.max(totalTimeMs, existing.timeMs);
          peakMemoryKb = Math.max(peakMemoryKb, existing.memoryKb);
          continue;
        }
        const caseWorkspace = path.join(
          workspace,
          `case-${group.orderIndex}-${caseName}-${Math.random().toString(16).slice(2)}`,
        );
        await mkdir(caseWorkspace, { recursive: true });
        try {
          const testCaseFiles = input.packageSource
            ? await input.packageSource.materializeTestCaseFiles(group.name, caseName, caseWorkspace)
            : await (async () => {
                const testCase = input.packageData!.groups
                  .find((candidate) => candidate.name === group.name)
                  ?.tests.find((candidate) => candidate.name === caseName);
                if (!testCase) {
                  throw new Error(`test case not found: ${group.name}/${caseName}`);
                }
                return materializeInlineTestCaseFiles({
                  testCase,
                  targetDir: caseWorkspace,
                });
              })();
          await input.onPhaseChange?.("running");
          const contestantOutputPath = path.join(caseWorkspace, "stdout.txt");
          const executed = await runWithFallback(runtimeTemplate, {
            cwd: submissionWorkspace,
            stdin: "",
            stdinFilePath: testCaseFiles.inputPath,
            timeoutMs: input.timeLimitMs,
            captureMemory: true,
            stdoutFilePath: contestantOutputPath,
            memoryLimitMb: input.memoryLimitMb,
          });
          const runResult = executed.result;

          totalTimeMs = Math.max(totalTimeMs, runResult.durationMs);
          peakMemoryKb = Math.max(peakMemoryKb, runResult.memoryKb);

          let verdict: SubmissionStatus = "accepted";
          let message = "Accepted";

          if (runResult.spawnErrorCode === "ENOENT") {
            verdict = "internal_error";
            message = `runtime not found: ${submissionCommands.execute.commands.join(" / ")}`;
          } else if (runResult.timedOut) {
            verdict = "time_limit_exceeded";
            message = "Time limit exceeded.";
          } else if (runResult.memoryLimitExceeded || runResult.memoryKb > input.memoryLimitMb * 1024) {
            verdict = "memory_limit_exceeded";
            message = "Memory limit exceeded.";
          } else if (runResult.outputLimitExceeded) {
            verdict = "runtime_error";
            message = "Output limit exceeded.";
          } else if (runResult.processLimitExceeded || runResult.workspaceLimitExceeded) {
            verdict = "runtime_error";
            message = runResult.processLimitExceeded ? "Process limit exceeded." : "Workspace limit exceeded.";
          } else if (runResult.exitCode !== 0) {
            verdict = "runtime_error";
            message = runResult.stderr || "Runtime error.";
          } else if (packageMeta.checkerType === "special_judge") {
            const checked =
              checkerRuntime && checkerWorkspace
                ? await runSpecialJudgeCase({
                    checkerWorkspace,
                    checkerRuntime,
                    inputPath: testCaseFiles.inputPath,
                    answerPath: testCaseFiles.outputPath,
                    contestantOutputPath,
                  })
                : {
                    verdict: "internal_error" as SubmissionStatus,
                    message: "special judge runtime is not prepared",
                  };
            verdict = checked.verdict;
            message = checked.message;
          } else if (
            !(await isOutputAcceptedFiles(
              contestantOutputPath,
              testCaseFiles.outputPath,
              packageMeta.compareMode,
            ))
          ) {
            verdict = "wrong_answer";
            message = "Expected output differs.";
          }

          if (!isAcceptedSubmissionStatus(verdict)) {
            groupAccepted = false;
          }

          const nextResult = {
            id: input.nextTestResultId(),
            groupName: group.name,
            testCaseName: testCaseFiles.name,
            verdict,
            timeMs: runResult.durationMs,
            memoryKb: runResult.memoryKb,
            message,
          };
          results.push(nextResult);
          await input.onTestResult?.({
            result: nextResult,
            totalTimeMs,
            peakMemoryKb,
          });
        } finally {
          try {
            await removeJudgeDirectory(caseWorkspace);
          } catch {
            // noop
          }
        }
      }

      judgedGroupStates.push({
        score: group.score,
        accepted: groupAccepted,
      });
    }

    await input.onPhaseChange?.("judging");
    return {
      status: overallVerdict(results),
      score: scoreFromGroups(packageMeta.scoringType, judgedGroupStates),
      totalTimeMs,
      peakMemoryKb,
      testResults: results,
    };
  } finally {
    try {
      await removeJudgeDirectory(workspace);
    } catch {
      // noop
    }
  }
}

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  wallDurationMs: number;
  memoryKb: number;
  spawnErrorCode?: string;
}

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

function resolveTimeWrapperCommand(): string | null {
  if (process.platform === "win32") {
    return null;
  }

  const candidates = ["/usr/bin/time", "/bin/time"];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function normalizeForTrailingSpacesCompare(text: string): string {
  const lines = normalizeNewlines(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

function isOutputAccepted(
  actual: string,
  expected: string,
  compareMode: ProblemPackageCompareMode,
): boolean {
  if (compareMode === "ignore_trailing_spaces") {
    return normalizeForTrailingSpacesCompare(actual) === normalizeForTrailingSpacesCompare(expected);
  }
  return normalizeNewlines(actual) === normalizeNewlines(expected);
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    stdin: string;
    timeoutMs: number;
    captureMemory: boolean;
  },
): Promise<CommandResult> {
  const startedAt = Date.now();
  const timeWrapperCommand = options.captureMemory ? resolveTimeWrapperCommand() : null;
  const useTimeWrapper = Boolean(timeWrapperCommand);
  const metricsPath = path.join(
    options.cwd,
    `metrics-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );

  const wrappedCommand = timeWrapperCommand ?? command;
  const wrappedArgs = useTimeWrapper
    ? ["-f", "%U\n%S\n%M", "-o", metricsPath, command, ...args]
    : args;

  return new Promise<CommandResult>((resolve) => {
    const child = spawn(wrappedCommand, wrappedArgs, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnErrorCode: string | undefined;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        child.kill();
      }
    }, Math.max(1, options.timeoutMs));

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnErrorCode = error.code;
    });

    child.on("close", async (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);

      const wallDurationMs = Date.now() - startedAt;
      let memoryKb = 0;
      let cpuDurationMs = wallDurationMs;
      if (useTimeWrapper) {
        try {
          const rawLines = (await readFile(metricsPath, "utf8"))
            .trim()
            .split(/\r?\n/);
          const userSeconds = Number(rawLines[0] ?? "");
          const systemSeconds = Number(rawLines[1] ?? "");
          const memoryValue = Number(rawLines[2] ?? "");
          if (
            Number.isFinite(userSeconds) &&
            userSeconds >= 0 &&
            Number.isFinite(systemSeconds) &&
            systemSeconds >= 0
          ) {
            cpuDurationMs = Math.round((userSeconds + systemSeconds) * 1000);
          }
          if (Number.isFinite(memoryValue) && memoryValue >= 0) {
            memoryKb = Math.floor(memoryValue);
          }
        } catch {
          cpuDurationMs = wallDurationMs;
          memoryKb = 0;
        }
      }

      try {
        if (useTimeWrapper) {
          await rm(metricsPath, { force: true });
        }
      } catch {
        // noop
      }

      resolve({
        stdout,
        stderr,
        exitCode,
        timedOut,
        durationMs: cpuDurationMs,
        wallDurationMs,
        memoryKb,
        spawnErrorCode,
      });
    });

    child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

async function runWithFallback(
  template: CommandTemplate,
  options: {
    cwd: string;
    stdin: string;
    timeoutMs: number;
    captureMemory: boolean;
  },
): Promise<{ result: CommandResult; usedCommand: string }> {
  let lastResult: CommandResult | null = null;
  for (const command of template.commands) {
    const result = await runCommand(command, template.args, options);
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
        durationMs: 0,
        wallDurationMs: 0,
        memoryKb: 0,
        spawnErrorCode: "ENOENT",
      } as CommandResult),
    usedCommand: template.commands[0] ?? "",
  };
}

function resolveLanguageCommands(language: Language, baseName = "Main"): {
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
        args: [`${baseName}.java`],
        timeoutMs: 20_000,
      },
      execute: {
        commands: ["java"],
        args: [baseName],
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
      args: [`${baseName}.js`],
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
  inputText: string;
  expectedText: string;
  actualText: string;
}): Promise<{
  verdict: SubmissionStatus;
  message: string;
}> {
  const caseDir = path.join(
    input.checkerWorkspace,
    `checker-case-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(caseDir, { recursive: true });

  const inputPath = path.join(caseDir, "input.txt");
  const answerPath = path.join(caseDir, "answer.txt");
  const outputPath = path.join(caseDir, "output.txt");
  await writeFile(inputPath, input.inputText, "utf8");
  await writeFile(answerPath, input.expectedText, "utf8");
  await writeFile(outputPath, input.actualText, "utf8");

  const checked = await runWithFallback(
    {
      commands: input.checkerRuntime.commands,
      args: [...input.checkerRuntime.args, inputPath, answerPath, outputPath],
    },
    {
      cwd: input.checkerWorkspace,
      stdin: "",
      timeoutMs: 10_000,
      captureMemory: false,
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

export async function executePackageJudge(input: {
  sourceCode: string;
  language: Language;
  timeLimitMs: number;
  memoryLimitMb: number;
  packageData?: ProblemPackageExtracted;
  packageSource?: LazyProblemPackageSource;
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

  const workspace = await mkdtemp(path.join(os.tmpdir(), "ojp-judge-"));
  try {
    const submissionWorkspace = path.join(workspace, "submission");
    await mkdir(submissionWorkspace, { recursive: true });
    const submissionCommands = resolveLanguageCommands(input.language);
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
      const checkerCommands = resolveLanguageCommands(packageMeta.checkerLanguage);
      const checkerSourcePath = path.join(checkerWorkspace, checkerCommands.sourceFileName);
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

    const results: Submission["testResults"] = [];
    const judgedGroupStates: Array<{ score: number; accepted: boolean }> = [];
    let totalTimeMs = 0;
    let peakMemoryKb = 0;

    for (const group of packageMeta.groups) {
      let groupAccepted = true;
      for (const caseName of group.caseNames) {
        const testCase = input.packageSource
          ? await input.packageSource.readTestCase(group.name, caseName)
          : input.packageData!.groups
              .find((candidate) => candidate.name === group.name)
              ?.tests.find((candidate) => candidate.name === caseName);
        if (!testCase) {
          throw new Error(`test case not found: ${group.name}/${caseName}`);
        }
        await input.onPhaseChange?.("running");
        const executed = await runWithFallback(runtimeTemplate, {
          cwd: submissionWorkspace,
          stdin: testCase.input,
          timeoutMs: input.timeLimitMs,
          captureMemory: true,
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
        } else if (runResult.memoryKb > input.memoryLimitMb * 1024) {
          verdict = "memory_limit_exceeded";
          message = "Memory limit exceeded.";
        } else if (runResult.exitCode !== 0) {
          verdict = "runtime_error";
          message = runResult.stderr || "Runtime error.";
        } else if (packageMeta.checkerType === "special_judge") {
          const checked =
            checkerRuntime && checkerWorkspace
              ? await runSpecialJudgeCase({
                  checkerWorkspace,
                  checkerRuntime,
                  inputText: testCase.input,
                  expectedText: testCase.output,
                  actualText: runResult.stdout,
                })
              : {
                  verdict: "internal_error" as SubmissionStatus,
                  message: "special judge runtime is not prepared",
                };
          verdict = checked.verdict;
          message = checked.message;
        } else if (!isOutputAccepted(runResult.stdout, testCase.output, packageMeta.compareMode)) {
          verdict = "wrong_answer";
          message = "Expected output differs.";
        }

        if (!isAcceptedSubmissionStatus(verdict)) {
          groupAccepted = false;
        }

        const nextResult = {
          id: input.nextTestResultId(),
          groupName: group.name,
          testCaseName: testCase.name,
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
      await rm(workspace, { recursive: true, force: true });
    } catch {
      // noop
    }
  }
}

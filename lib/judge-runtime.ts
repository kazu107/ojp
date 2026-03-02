import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  ProblemPackageExtracted,
  ProblemPackageScoringType,
  ProblemPackageCompareMode,
} from "@/lib/problem-package";
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
    ? ["-f", "%M", "-o", metricsPath, command, ...args]
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

      let memoryKb = 0;
      if (useTimeWrapper) {
        try {
          const raw = (await readFile(metricsPath, "utf8")).trim();
          const parsed = Number(raw);
          if (Number.isFinite(parsed) && parsed >= 0) {
            memoryKb = Math.floor(parsed);
          }
        } catch {
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
        durationMs: Date.now() - startedAt,
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
        memoryKb: 0,
        spawnErrorCode: "ENOENT",
      } as CommandResult),
    usedCommand: template.commands[0] ?? "",
  };
}

function resolveLanguageCommands(language: Language): {
  sourceFileName: string;
  compile?: CommandTemplate & { timeoutMs: number };
  execute: CommandTemplate;
} {
  if (language === "cpp") {
    return {
      sourceFileName: "Main.cpp",
      compile: {
        commands: ["g++", "clang++"],
        args: ["Main.cpp", "-O2", "-std=gnu++17", "-o", "main"],
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
      sourceFileName: "Main.py",
      compile: {
        commands: ["python3", "python"],
        args: ["-m", "py_compile", "Main.py"],
        timeoutMs: 10_000,
      },
      execute: {
        commands: ["python3", "python"],
        args: ["Main.py"],
      },
    };
  }

  if (language === "java") {
    return {
      sourceFileName: "Main.java",
      compile: {
        commands: ["javac"],
        args: ["Main.java"],
        timeoutMs: 20_000,
      },
      execute: {
        commands: ["java"],
        args: ["Main"],
      },
    };
  }

  return {
    sourceFileName: "Main.js",
    compile: {
      commands: ["node"],
      args: ["--check", "Main.js"],
      timeoutMs: 10_000,
    },
    execute: {
      commands: ["node"],
      args: ["Main.js"],
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

export async function executePackageJudge(input: {
  sourceCode: string;
  language: Language;
  timeLimitMs: number;
  memoryLimitMb: number;
  packageData: ProblemPackageExtracted;
  nextTestResultId: () => string;
  onPhaseChange?: (status: "compiling" | "running" | "judging") => void;
}): Promise<JudgeResult> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "ojp-judge-"));
  try {
    const commands = resolveLanguageCommands(input.language);
    const sourcePath = path.join(workspace, commands.sourceFileName);
    await writeFile(sourcePath, input.sourceCode, "utf8");

    if (commands.compile) {
      input.onPhaseChange?.("compiling");
      const compiled = await runWithFallback(
        {
          commands: commands.compile.commands,
          args: commands.compile.args,
        },
        {
          cwd: workspace,
          stdin: "",
          timeoutMs: commands.compile.timeoutMs,
          captureMemory: false,
        },
      );
      const compileResult = compiled.result;
      if (compileResult.spawnErrorCode === "ENOENT") {
        return {
          status: "internal_error",
          score: 0,
          totalTimeMs: 0,
          peakMemoryKb: 0,
          testResults: [
            {
              id: input.nextTestResultId(),
              groupName: "compile",
              testCaseName: "-",
              verdict: "internal_error",
              timeMs: 0,
              memoryKb: 0,
              message: `toolchain not found: ${commands.compile.commands.join(" / ")}`,
            },
          ],
        };
      }
      if (compileResult.timedOut) {
        return {
          status: "compilation_error",
          score: 0,
          totalTimeMs: 0,
          peakMemoryKb: 0,
          testResults: [
            {
              id: input.nextTestResultId(),
              groupName: "compile",
              testCaseName: "-",
              verdict: "compilation_error",
              timeMs: compileResult.durationMs,
              memoryKb: 0,
              message: "compile timeout",
            },
          ],
        };
      }
      if (compileResult.exitCode !== 0) {
        return {
          status: "compilation_error",
          score: 0,
          totalTimeMs: 0,
          peakMemoryKb: 0,
          testResults: [
            {
              id: input.nextTestResultId(),
              groupName: "compile",
              testCaseName: "-",
              verdict: "compilation_error",
              timeMs: compileResult.durationMs,
              memoryKb: 0,
              message: compileResult.stderr || "compile failed",
            },
          ],
        };
      }
    }

    const runtimeTemplate = {
      commands: commands.execute.commands,
      args: commands.execute.args,
    };

    const results: Submission["testResults"] = [];
    const judgedGroupStates: Array<{ score: number; accepted: boolean }> = [];
    let totalTimeMs = 0;
    let peakMemoryKb = 0;

    for (const group of input.packageData.groups) {
      let groupAccepted = true;
      for (const testCase of group.tests) {
        input.onPhaseChange?.("running");
        const executed = await runWithFallback(runtimeTemplate, {
          cwd: workspace,
          stdin: testCase.input,
          timeoutMs: input.timeLimitMs,
          captureMemory: true,
        });
        const runResult = executed.result;

        totalTimeMs += runResult.durationMs;
        peakMemoryKb = Math.max(peakMemoryKb, runResult.memoryKb);

        let verdict: SubmissionStatus = "accepted";
        let message = "Accepted";

        if (runResult.spawnErrorCode === "ENOENT") {
          verdict = "internal_error";
          message = `runtime not found: ${commands.execute.commands.join(" / ")}`;
        } else if (runResult.timedOut) {
          verdict = "time_limit_exceeded";
          message = "Time limit exceeded.";
        } else if (runResult.memoryKb > input.memoryLimitMb * 1024) {
          verdict = "memory_limit_exceeded";
          message = "Memory limit exceeded.";
        } else if (runResult.exitCode !== 0) {
          verdict = "runtime_error";
          message = runResult.stderr || "Runtime error.";
        } else if (
          !isOutputAccepted(runResult.stdout, testCase.output, input.packageData.compareMode)
        ) {
          verdict = "wrong_answer";
          message = "Expected output differs.";
        }

        if (!isAcceptedSubmissionStatus(verdict)) {
          groupAccepted = false;
        }

        results.push({
          id: input.nextTestResultId(),
          groupName: group.name,
          testCaseName: testCase.name,
          verdict,
          timeMs: runResult.durationMs,
          memoryKb: runResult.memoryKb,
          message,
        });
      }

      judgedGroupStates.push({
        score: group.score,
        accepted: groupAccepted,
      });
    }

    input.onPhaseChange?.("judging");
    return {
      status: overallVerdict(results),
      score: scoreFromGroups(input.packageData.scoringType, judgedGroupStates),
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

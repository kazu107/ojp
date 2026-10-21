import { closeSync, existsSync, openSync } from "node:fs";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  buildBubblewrapArguments,
  createJudgeEnvironment,
  getJudgeSandboxMode,
  resolveBubblewrap,
  resolveJudgeExecutable,
  type JudgeReadOnlyFile,
} from "./judge-sandbox";

export interface JudgeCommandResult {
  stdout: string;
  stderr: string;
  stdoutFilePath: string | null;
  exitCode: number | null;
  timedOut: boolean;
  memoryLimitExceeded: boolean;
  outputLimitExceeded: boolean;
  processLimitExceeded: boolean;
  workspaceLimitExceeded: boolean;
  durationMs: number;
  cpuDurationMs: number;
  wallDurationMs: number;
  memoryKb: number;
  spawnErrorCode?: string;
}

export interface JudgeCommandOptions {
  cwd: string;
  stdin: string;
  stdinFilePath?: string | null;
  timeoutMs: number;
  captureMemory: boolean;
  stdoutFilePath?: string | null;
  maxStdoutCaptureBytes?: number;
  maxStderrCaptureBytes?: number;
  memoryLimitMb?: number;
  outputLimitBytes?: number;
  processLimit?: number;
  workspaceLimitBytes?: number;
  readOnlyFiles?: JudgeReadOnlyFile[];
}

function configuredLimit(name: string, fallback: number, maximum: number): number {
  const configured = process.env[name]?.trim();
  if (!configured) return fallback;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

export function getJudgeResourceLimits() {
  return {
    outputBytes: configuredLimit("JUDGE_MAX_OUTPUT_BYTES", 64 * 1024 * 1024, 512 * 1024 * 1024),
    workspaceBytes: configuredLimit("JUDGE_MAX_WORKSPACE_BYTES", 128 * 1024 * 1024, 1024 * 1024 * 1024),
    processes: configuredLimit("JUDGE_MAX_PROCESSES", 128, 1024),
    compilerMemoryMb: configuredLimit("JUDGE_COMPILER_MEMORY_MB", 256, 4096),
    checkerMemoryMb: configuredLimit("JUDGE_CHECKER_MEMORY_MB", 256, 4096),
  };
}

function displayDuration(cpuMs: number, wallMs: number): number {
  if (!Number.isFinite(wallMs) || wallMs <= 0) return Math.max(1, cpuMs || 0);
  if (!Number.isFinite(cpuMs) || cpuMs <= 0 || wallMs <= 20) return wallMs;
  return cpuMs < wallMs - 20 ? cpuMs : wallMs;
}

function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
    const terminator = spawn(path.join(systemRoot, "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        env: createJudgeEnvironment(os.tmpdir(), "basic"),
      });
    terminator.on("error", () => child.kill("SIGKILL"));
    terminator.unref();
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

interface ProcessUsage {
  memoryKb: number;
  processes: number;
}

async function readProcessTreeUsage(rootPid: number): Promise<ProcessUsage> {
  const pending = [rootPid];
  const seen = new Set<number>();
  let memoryKb = 0;
  let processes = 0;
  while (pending.length > 0 && seen.size < 2048) {
    const pid = pending.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const status = await readFile(`/proc/${pid}/status`, "utf8");
      memoryKb += Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
      processes += Number(status.match(/^Threads:\s+(\d+)/m)?.[1] ?? 1);
      const children = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
      pending.push(...children.trim().split(/\s+/).filter(Boolean).map(Number));
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  return { memoryKb, processes };
}

async function workspaceUsage(directory: string, limit: number): Promise<number> {
  let bytes = 0;
  let entries = 0;
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!(await lstat(current)).isDirectory()) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (++entries > 4096) return limit + 1;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) bytes += (await stat(entryPath)).size;
      if (bytes > limit) return bytes;
    }
  }
  return bytes;
}

export async function removeJudgeDirectory(directory: string): Promise<void> {
  const restoreDirectories = async (current: string): Promise<void> => {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) return;
    // A program may remove directory permissions; restore only directories, never symlink targets.
    await chmod(current, 0o700);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) await restoreDirectories(path.join(current, entry.name));
    }
  };
  try {
    await restoreDirectories(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rm(directory, { recursive: true, force: true });
}

const readySandboxes = new Map<string, Promise<void>>();

export async function assertJudgeSandboxReady(): Promise<void> {
  if (getJudgeSandboxMode() === "basic") return;
  const command = resolveBubblewrap();
  if (!readySandboxes.has(command)) {
    readySandboxes.set(command, (async () => {
      const cwd = await mkdtemp(path.join(os.tmpdir(), "ojp-sandbox-probe-"));
      try {
        const env = createJudgeEnvironment(cwd, "bubblewrap");
        const args = buildBubblewrapArguments({ executable: "/usr/bin/true", args: [], cwd, tempDir: cwd, env });
        await new Promise<void>((resolve, reject) => {
          let detail = "";
          const probe = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "ignore", "pipe"] });
          const timer = setTimeout(() => {
            terminateProcessTree(probe);
            reject(new Error("bubblewrap preflight timed out"));
          }, 5000);
          probe.stderr?.on("data", (chunk: Buffer) => { detail = (detail + chunk.toString()).slice(0, 4096); });
          probe.once("error", (error) => { clearTimeout(timer); reject(error); });
          probe.once("close", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`bubblewrap is unavailable on this worker: ${detail.trim() || `exit ${code}`}. Execution was blocked.`));
          });
        });
      } finally {
        await removeJudgeDirectory(cwd);
      }
    })());
  }
  await readySandboxes.get(command);
}

export async function runJudgeCommand(
  command: string,
  args: string[],
  options: JudgeCommandOptions,
): Promise<JudgeCommandResult> {
  const limits = getJudgeResourceLimits();
  const sandbox = getJudgeSandboxMode();
  await assertJudgeSandboxReady();
  const env = createJudgeEnvironment(options.cwd, sandbox);
  const executable = await resolveJudgeExecutable(command, options.cwd, env);
  const empty: JudgeCommandResult = {
    stdout: "", stderr: "", stdoutFilePath: options.stdoutFilePath ?? null,
    exitCode: null, timedOut: false, memoryLimitExceeded: false, outputLimitExceeded: false,
    processLimitExceeded: false, workspaceLimitExceeded: false,
    durationMs: 0, cpuDurationMs: 0, wallDurationMs: 0, memoryKb: 0,
  };
  if (!executable) return { ...empty, spawnErrorCode: "ENOENT" };

  const outputLimit = options.outputLimitBytes ?? limits.outputBytes;
  const processLimit = options.processLimit ?? limits.processes;
  const workspaceLimit = options.workspaceLimitBytes ?? limits.workspaceBytes;
  const fileSizeLimit = options.stdoutFilePath ? outputLimit : workspaceLimit;
  const prlimit = process.platform === "linux"
    ? ["/usr/bin/prlimit", "/bin/prlimit"].find((candidate) => existsSync(candidate))
    : undefined;
  if (process.platform === "linux" && !prlimit) {
    throw new Error("prlimit is required on Linux judge workers; install util-linux");
  }
  const timeWrapper = options.captureMemory && process.platform !== "win32"
    ? ["/usr/bin/time", "/bin/time"].find((candidate) => existsSync(candidate))
    : undefined;
  // Keep metrics outside the contestant's writable directory and bound reads below.
  const metricsDir = await mkdtemp(path.join(os.tmpdir(), "ojp-judge-metrics-"));
  const metricsPath = path.join(metricsDir, "metrics.txt");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ojp-judge-tmp-"));
  if (sandbox === "basic") {
    env.TMPDIR = tempDir;
    env.TEMP = tempDir;
    env.TMP = tempDir;
  }
  let launchedCommand = executable;
  let launchedArgs = args;
  const resourceArgs = [
    `--cpu=${Math.max(1, Math.ceil(options.timeoutMs / 1000) + 1)}`,
    `--fsize=${fileSizeLimit}`, "--nofile=128", "--core=0",
  ];
  if (sandbox === "bubblewrap") {
    launchedCommand = resolveBubblewrap();
    launchedArgs = buildBubblewrapArguments({
      executable, args, cwd: options.cwd, tempDir, env, readOnlyFiles: options.readOnlyFiles,
      resourceWrapper: { executable: prlimit!, args: [...resourceArgs, `--nproc=${processLimit}`] },
    });
  } else if (prlimit) {
    // RLIMIT_NPROC is per UID: applying it to a shared worker UID penalizes unrelated jobs.
    // Only set it inside a private user namespace; basic mode monitors this job's tree instead.
    launchedArgs = [...resourceArgs, "--", executable, ...args];
    launchedCommand = prlimit;
  }
  if (timeWrapper) {
    launchedArgs = ["-f", "%U\n%S\n%M", "-o", metricsPath, launchedCommand, ...launchedArgs];
    launchedCommand = timeWrapper;
  }

  let stdinFd: number | undefined;
  let stdoutFd: number | undefined;
  try {
    if (options.stdinFilePath) stdinFd = openSync(options.stdinFilePath, "r");
    if (options.stdoutFilePath) stdoutFd = openSync(options.stdoutFilePath, "w");
    const result = await new Promise<JudgeCommandResult>((resolve, reject) => {
      const startedAt = process.hrtime.bigint();
      const child = spawn(/* turbopackIgnore: true */ launchedCommand, launchedArgs, {
        cwd: options.cwd, env, windowsHide: true, detached: process.platform !== "win32",
        stdio: [stdinFd ?? "pipe", stdoutFd ?? "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let pendingMonitor: Promise<void> | null = null;
      let stopping = false;
      let finished = false;
      let lastWorkspaceCheck = 0;
      let memoryKb = 0;
      let outputBytes = 0;
      let monitorError: Error | null = null;
      const state = { ...empty };
      const stop = () => { if (!stopping) { stopping = true; terminateProcessTree(child); } };
      const capture = (chunk: Buffer, stream: "stdout" | "stderr") => {
        const maxBytes = stream === "stdout"
          ? options.maxStdoutCaptureBytes ?? 256 * 1024
          : options.maxStderrCaptureBytes ?? 64 * 1024;
        const previous = stream === "stdout" ? stdoutBytes : stderrBytes;
        const text = chunk.subarray(0, Math.max(0, maxBytes - previous)).toString("utf8");
        if (stream === "stdout") { stdout += text; stdoutBytes += chunk.length; }
        else { stderr += text; stderrBytes += chunk.length; }
        if (previous + chunk.length > maxBytes) { state.outputLimitExceeded = true; stop(); }
      };
      child.stdout?.on("data", (chunk: Buffer) => capture(chunk, "stdout"));
      child.stderr?.on("data", (chunk: Buffer) => capture(chunk, "stderr"));
      child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
        if (finished) return;
        if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") {
          monitorError = error; stop();
        }
      });
      child.once("error", (error: NodeJS.ErrnoException) => { state.spawnErrorCode = error.code; });

      const monitor = async () => {
        if (finished || stopping) return;
        try {
          if (process.platform === "linux" && child.pid) {
            const usage = await readProcessTreeUsage(child.pid);
            memoryKb = Math.max(memoryKb, usage.memoryKb);
            if (options.memoryLimitMb && usage.memoryKb > options.memoryLimitMb * 1024) state.memoryLimitExceeded = true;
            if (usage.processes > processLimit) state.processLimitExceeded = true;
          }
          if (options.stdoutFilePath) {
            outputBytes = (await stat(options.stdoutFilePath)).size;
            if (outputBytes > outputLimit) state.outputLimitExceeded = true;
          }
          if (Date.now() - lastWorkspaceCheck > 200) {
            lastWorkspaceCheck = Date.now();
            const workBytes = await workspaceUsage(options.cwd, workspaceLimit);
            const tempBytes = await workspaceUsage(tempDir, workspaceLimit);
            if (workBytes + tempBytes > workspaceLimit) state.workspaceLimitExceeded = true;
          }
          if (state.memoryLimitExceeded || state.outputLimitExceeded || state.processLimitExceeded || state.workspaceLimitExceeded) stop();
        } catch (error) {
          if (!finished && (error as NodeJS.ErrnoException).code !== "ENOENT") {
            monitorError = error as Error; stop();
          }
        }
      };
      const monitorTimer = setInterval(() => {
        if (!pendingMonitor) pendingMonitor = monitor().finally(() => { pendingMonitor = null; });
      }, 40);
      const timeout = setTimeout(() => { state.timedOut = true; stop(); }, Math.max(1, options.timeoutMs));
      // Stop descendants even if the submitted main process exits successfully.
      child.once("exit", () => {
        if (process.platform !== "win32") terminateProcessTree(child);
      });
      child.once("close", async (exitCode, signal) => {
        finished = true;
        clearInterval(monitorTimer);
        clearTimeout(timeout);
        const wallDurationMs = Math.max(0, Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000));
        let cpuDurationMs = wallDurationMs;
        await pendingMonitor;
        try {
          if (options.stdoutFilePath) outputBytes = (await stat(options.stdoutFilePath)).size;
          if (outputBytes > outputLimit || signal === "SIGXFSZ" || (exitCode !== 0 && outputBytes >= outputLimit)) state.outputLimitExceeded = true;
          if (timeWrapper && (await stat(metricsPath)).size <= 4096) {
            const values = (await readFile(metricsPath, "utf8")).trim().split(/\r?\n/).slice(-3);
            const cpuSeconds = Number(values[0]) + Number(values[1]);
            const measuredMemory = Number(values[2]);
            if (Number.isFinite(cpuSeconds) && cpuSeconds >= 0) cpuDurationMs = Math.round(cpuSeconds * 1000);
            if (Number.isFinite(measuredMemory) && measuredMemory >= 0) memoryKb = Math.max(memoryKb, measuredMemory);
          }
        } catch {
          // Live monitoring and monotonic wall time remain available if GNU time was killed.
        }
        if (options.memoryLimitMb && memoryKb > options.memoryLimitMb * 1024) state.memoryLimitExceeded = true;
        if (monitorError) { reject(monitorError); return; }
        resolve({
          ...state, stdout, stderr, exitCode,
          durationMs: displayDuration(cpuDurationMs, wallDurationMs),
          cpuDurationMs, wallDurationMs, memoryKb,
        });
      });
      if (child.stdin) child.stdin.end(options.stdin);
    });
    return result;
  } finally {
    if (stdinFd !== undefined) closeSync(stdinFd);
    if (stdoutFd !== undefined) closeSync(stdoutFd);
    await removeJudgeDirectory(metricsDir);
    await removeJudgeDirectory(tempDir);
  }
}

import type { ChildProcess } from "node:child_process";
import { Transform } from "node:stream";
import { runJudgeCommand, getJudgeResourceLimits, type JudgeCommandResult } from "./judge-process";
import { createJudgeEnvironment, getJudgeSandboxMode, resolveJudgeExecutable } from "./judge-sandbox";
import { parseInteractiveLimits, type InteractiveLimits } from "./interactive-config";
import type { SubmissionStatus } from "./types";

interface Program {
  commands: string[];
  args: string[];
  cwd: string;
}

export async function runInteractiveCase(input: {
  contestant: Program;
  interactor: Program;
  inputPath: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  limits?: InteractiveLimits;
  logLimitBytes?: number;
  signal?: AbortSignal;
}): Promise<{ result: JudgeCommandResult; verdict: SubmissionStatus; message: string; interactionLog: string }> {
  const limits = parseInteractiveLimits(input.limits);
  const resources = getJudgeResourceLimits();
  const controllers = [new AbortController(), new AbortController()];
  const children: Array<ChildProcess | undefined> = [];
  let firstExitRole: number | undefined;
  const relays: Transform[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const started = performance.now();
  const logLimit = Math.max(0, Math.min(input.logLimitBytes ?? 16384, 16384));
  let logBytes = 0;
  let interactionLog = "";
  let truncated = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let failure: { verdict: SubmissionStatus; message: string } | undefined;
  let linked = false;
  let finishing = false;

  const log = (direction: string, chunk: Buffer) => {
    const prefix = `[${Math.round(performance.now() - started)} ms] ${direction}: `;
    const available = Math.max(0, logLimit - logBytes - Buffer.byteLength(prefix) - 1);
    if (available === 0) { truncated = true; return; }
    const text = prefix + chunk.subarray(0, available).toString("utf8") + "\n";
    logBytes += Buffer.byteLength(text);
    interactionLog += text;
    if (chunk.length > available) truncated = true;
  };
  const abortBoth = () => controllers.forEach((controller) => controller.abort());
  const fail = (verdict: SubmissionStatus, message: string) => {
    failure ??= { verdict, message };
    abortBoth();
  };
  const resetIdle = () => {
    clearTimeout(idleTimer);
    if (!linked || firstExitRole !== undefined || finishing) return;
    idleTimer = setTimeout(() => fail("time_limit_exceeded", "Interaction idle timeout (check flush and protocol)."), limits.idleTimeLimitMs);
  };
  const connect = () => {
    if (linked || !children[0]?.stdout || !children[1]?.stdout || !relays[0] || !relays[1]) return;
    linked = true;
    resetIdle();
    relays[0].pipe(children[1]!.stdin!);
    relays[1].pipe(children[0]!.stdin!);
  };
  const onStart = (role: number) => (child: ChildProcess) => {
    children[role] = child;
    const relay = new Transform({ highWaterMark: 16384, transform(chunk: Buffer, _encoding, callback) {
      resetIdle();
      log(role === 0 ? "submission -> interactor" : "interactor -> submission", chunk);
      callback(null, chunk);
    } });
    const onError = (error: NodeJS.ErrnoException) => {
      if (!["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_PREMATURE_CLOSE"].includes(error.code ?? "")) {
        fail("internal_error", "Interactive pipe failed.");
      }
    };
    relay.on("error", onError);
    child.stdin?.on("error", onError);
    // Start buffering immediately, before the peer is ready, with backpressure.
    child.stdout?.on("error", onError).pipe(relay);
    relays[role] = relay;
    child.once("exit", () => {
      firstExitRole ??= role;
      clearTimeout(idleTimer);
      // Allow the peer to consume EOF and finish; never wait indefinitely for it.
      if (!finishing) timers.push(setTimeout(() => controllers[1 - role].abort(), 750));
    });
    connect();
  };
  const resolveCommand = async (program: Program) => {
    for (const command of program.commands) {
      const executable = await resolveJudgeExecutable(command, program.cwd, createJudgeEnvironment(program.cwd, getJudgeSandboxMode()));
      if (executable) return executable;
    }
    throw new Error(`interactive runtime not found: ${program.commands.join(" / ")}`);
  };
  const contestantCommand = await resolveCommand(input.contestant);
  const interactorCommand = await resolveCommand(input.interactor);
  const cancel = () => fail("internal_error", "Interactive execution cancelled.");
  input.signal?.addEventListener("abort", cancel, { once: true });
  if (input.signal?.aborted) cancel();
  timers.push(setTimeout(() => fail("time_limit_exceeded", "Interaction wall time limit exceeded."), limits.wallTimeLimitMs));
  const jobs = [
    runJudgeCommand(contestantCommand, input.contestant.args, {
      cwd: input.contestant.cwd, stdin: "", timeoutMs: limits.wallTimeLimitMs + 1000,
      outputLimitBytes: Math.min(resources.outputBytes, 1024 * 1024),
      cpuTimeLimitMs: input.timeLimitMs, memoryLimitMb: input.memoryLimitMb,
      captureMemory: true, onStart: onStart(0), signal: controllers[0].signal,
    }),
    runJudgeCommand(interactorCommand, [...input.interactor.args, input.inputPath], {
      cwd: input.interactor.cwd, stdin: "", timeoutMs: limits.wallTimeLimitMs + 1000,
      outputLimitBytes: Math.min(resources.outputBytes, 1024 * 1024),
      cpuTimeLimitMs: limits.interactorTimeLimitMs, memoryLimitMb: resources.checkerMemoryMb,
      captureMemory: true, onStart: onStart(1), signal: controllers[1].signal,
      readOnlyFiles: [{ source: input.inputPath, destination: "/cases/input.txt" }],
    }),
  ].map((job) => job.then((result) => {
    if (result.spawnErrorCode) fail("internal_error", "Interactive runtime failed to start.");
    return result;
  }));
  try {
    const [contestant, interactor] = await Promise.all(jobs);
    log("interactor stderr (private)", Buffer.from(interactor.stderr));
    const exceeded = (result: JudgeCommandResult) => result.memoryLimitExceeded || result.outputLimitExceeded || result.processLimitExceeded || result.workspaceLimitExceeded;
    // Distinguish a real interactor failure from termination caused by the peer.
    if (!controllers[1].signal.aborted && (interactor.spawnErrorCode || interactor.timedOut || exceeded(interactor) || ![0, 1].includes(interactor.exitCode ?? -1))) {
      failure = { verdict: "internal_error", message: "Interactor failed or exceeded its resource limit." };
    } else if (!failure && contestant.timedOut) {
      failure = { verdict: "time_limit_exceeded", message: "Time limit exceeded." };
    } else if (!failure && contestant.memoryLimitExceeded) {
      failure = { verdict: "memory_limit_exceeded", message: "Memory limit exceeded." };
    } else if (!failure && exceeded(contestant)) {
      failure = { verdict: "runtime_error", message: "Submission resource limit exceeded." };
    } else if (!failure && firstExitRole === 0 && contestant.exitCode !== 0) {
      failure = { verdict: "runtime_error", message: "Submission exited abnormally." };
    } else if (!failure && interactor.exitCode === 1) {
      failure = { verdict: "wrong_answer", message: "Interaction rejected by interactor." };
    } else if (!failure && (contestant.spawnErrorCode || contestant.exitCode !== 0)) {
      failure = { verdict: "runtime_error", message: "Submission exited abnormally or did not terminate after interaction." };
    } else if (!failure && interactor.exitCode !== 0) {
      failure = { verdict: "internal_error", message: "Interactor did not produce a verdict after submission ended." };
    }
    return {
      result: contestant,
      verdict: failure?.verdict ?? "accepted",
      message: failure?.message ?? "Accepted",
      interactionLog: logLimit === 0 ? "" : Buffer.from(
        truncated ? interactionLog.slice(0, Math.max(0, interactionLog.length - 40)) + "\n[interaction log truncated]\n" : interactionLog,
      ).subarray(0, logLimit).toString("utf8").replace(/\uFFFD$/, ""),
    };
  } finally {
    finishing = true;
    input.signal?.removeEventListener("abort", cancel);
    clearTimeout(idleTimer);
    timers.forEach(clearTimeout);
    abortBoth();
    relays.forEach((relay) => relay.destroy());
    await Promise.allSettled(jobs);
    // Release process handles after both trees have been reaped.
    children.length = 0;
  }
}

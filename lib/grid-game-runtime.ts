import type { ChildProcess } from "node:child_process";
import {
  GridGame,
  gridGameObservationText,
  simulateGridGame,
  type BoardConfig,
  type GridGameConfig,
  type BoardReplay,
} from "./board-visualization";
import { getJudgeSandboxMode } from "./judge-sandbox";
import { runJudgeCommand, type JudgeCommandResult } from "./judge-process";
import type { SubmissionStatus } from "./types";

export function assertGameExecutionAllowed() {
  if (getJudgeSandboxMode() === "bubblewrap") return;
  if (
    process.env.NODE_ENV === "test" &&
    process.env.OJP_GAME_UNSAFE_LOCAL_TEST === "1"
  )
    return;
  throw new Error(
    "Grid games require an isolated bubblewrap worker. Unisolated production game execution is disabled.",
  );
}
export interface GridGameCaseResult {
  result: JudgeCommandResult;
  verdict: SubmissionStatus;
  message: string;
  rawScore: string | null;
  replay: BoardReplay;
}

export async function runGridGameCase(input: {
  commands: string[];
  args: string[];
  cwd: string;
  board: BoardConfig;
  game: GridGameConfig;
  input: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}): Promise<GridGameCaseResult> {
  assertGameExecutionAllowed();
  const state = new GridGame(input.input, input.board, input.game);
  const abort = new AbortController();
  let child: ChildProcess | undefined,
    pending = "",
    timer: ReturnType<typeof setTimeout> | undefined,
    grace: ReturnType<typeof setTimeout> | undefined;
  let failure: { verdict: SubmissionStatus; message: string } | undefined;
  const fail = (verdict: SubmissionStatus, message: string) => {
    failure ??= { verdict, message };
    abort.abort();
  };
  const send = () => {
    if (!child?.stdin?.writable) return;
    clearTimeout(timer);
    child.stdin.write(gridGameObservationText(state));
    if (state.finished) {
      if (!state.success)
        failure ??= { verdict: "wrong_answer", message: state.message };
      child.stdin.end();
      grace = setTimeout(() => {
        if (!state.success) fail("wrong_answer", state.message);
        else
          fail(
            "runtime_error",
            "Game program did not terminate after the final observation",
          );
      }, 750);
    } else
      timer = setTimeout(
        () =>
          fail(
            "time_limit_exceeded",
            "Game turn timeout; flush one action per observation",
          ),
        state.turn === 0
          ? input.game.firstTurnTimeLimitMs
          : input.game.turnTimeLimitMs,
      );
  };
  try {
    let result: JudgeCommandResult | undefined;
    for (const command of input.commands) {
      result = await runJudgeCommand(command, input.args, {
        cwd: input.cwd,
        stdin: input.input,
        timeoutMs:
          input.game.protocol === "turns"
            ? Math.min(
                60000,
                input.game.firstTurnTimeLimitMs +
                  input.game.maxTurns * input.game.turnTimeLimitMs +
                  1000,
              )
            : input.timeLimitMs,
        cpuTimeLimitMs: input.timeLimitMs,
        memoryLimitMb: input.memoryLimitMb,
        captureMemory: true,
        outputLimitBytes: 65536,
        maxStdoutCaptureBytes: 65536,
        signal: abort.signal,
        ...(input.game.protocol === "turns"
          ? {
              onStart: (process: ChildProcess) => {
                child = process;
                child.stdin?.on("error", () => {
                  if (!state.finished)
                    fail("runtime_error", "Game input pipe closed");
                });
                child.stdout?.on("data", (chunk: Buffer) => {
                  if (state.finished || failure) return;
                  pending += chunk.toString("utf8");
                  if (pending.length > 65536) {
                    fail("runtime_error", "Game output exceeds limit");
                    return;
                  }
                  for (;;) {
                    const newline = pending.indexOf("\n");
                    if (newline < 0) break;
                    const action = pending.slice(0, newline);
                    pending = pending.slice(newline + 1);
                    if (action.length > 64) {
                      fail("runtime_error", "Game action exceeds limit");
                      return;
                    }
                    state.step(action);
                    send();
                    if (state.finished || failure) return;
                  }
                  if (pending.length > 64)
                    fail("runtime_error", "Game action exceeds limit");
                });
                send();
              },
            }
          : {}),
      });
      if (result.spawnErrorCode !== "ENOENT") break;
    }
    if (!result) throw new Error("Game runtime is unavailable");
    let replay =
      input.game.protocol === "moves"
        ? simulateGridGame(input.input, result.stdout, input.board, input.game)
        : state.replay();
    if (failure?.verdict !== "wrong_answer") {
      if (result.spawnErrorCode)
        failure = {
          verdict: "internal_error",
          message: "Game runtime is unavailable",
        };
      else if (result.memoryLimitExceeded)
        failure = {
          verdict: "memory_limit_exceeded",
          message: "Game program memory limit exceeded",
        };
      else if (result.timedOut)
        failure = {
          verdict: "time_limit_exceeded",
          message: "Game program time limit exceeded",
        };
      else if (
        result.outputLimitExceeded ||
        result.processLimitExceeded ||
        result.workspaceLimitExceeded
      )
        failure = {
          verdict: "runtime_error",
          message: "Game program resource limit exceeded",
        };
      else if (!failure && result.exitCode !== 0)
        failure = {
          verdict: "runtime_error",
          message: "Game program exited abnormally",
        };
      else if (!failure && !replay.success)
        failure = {
          verdict: "wrong_answer",
          message: replay.message || "Game program ended before the goal",
        };
    }
    if (failure)
      replay = {
        ...replay,
        score: null,
        success: false,
        message: failure.message,
      };
    return {
      result,
      verdict: failure?.verdict ?? "accepted",
      message: failure?.message ?? "Goal reached",
      rawScore: replay.score ?? null,
      replay,
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(grace);
    abort.abort();
  }
}

import type { ChildProcess } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertGameExecutionAllowed } from "./grid-game-runtime";
import { assertJudgeSandboxReady, removeJudgeDirectory, runJudgeCommand } from "./judge-process";
import { stageJudgeProgram } from "./judge-runtime";
import { compileDeliveryProgram } from "./delivery-compile-cache";
import { getJudgeSandboxMode, createJudgeEnvironment, resolveJudgeExecutable } from "./judge-sandbox";
import { DeliveryGame, parseDeliveryAction, standardDeliveryAction, type DeliveryAction, type DeliveryMap, type DeliveryResult } from "./delivery-game";
import type { Language } from "./types";

export const DELIVERY_SOURCE_BYTES = 65536;
const MEMORY_MB = 128;
const FIRST_TURN_MS = 2500;
const TURN_MS = 250;
const WALL_MS = 32000;
export type DeliveryBotSource = { language: Language; sourceCode: string };
type Turn = { action: DeliveryAction } | { fault: string };

function spawnPeer(command: string, args: string[], cwd: string) {
  const controller = new AbortController();
  let child: ChildProcess | undefined, plannedEnd = false, fault: string | null = null, infrastructure: Error | undefined;
  let wait: ((r: Turn) => void) | undefined, buffer = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ready: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  function finish(r: Turn) {
    clearTimeout(timer);
    const handle = wait;
    wait = undefined;
    handle?.(r);
  }
  function fail(reason: string) {
    fault ??= reason;
    finish({ fault });
    controller.abort();
  }
  const completed = runJudgeCommand(command, args, {
    cwd, stdin: "", timeoutMs: WALL_MS, cpuTimeLimitMs: 10000, memoryLimitMb: MEMORY_MB,
    outputLimitBytes: 16384, maxStdoutCaptureBytes: 8192, maxStderrCaptureBytes: 2048,
    processLimit: 32, workspaceLimitBytes: 4 * 1024 * 1024, captureMemory: true, signal: controller.signal,
    onStart(proc) {
      child = proc;
      proc.stdin?.on("error", () => { if (!plannedEnd) fail("Program closed its input"); });
      proc.stdout?.on("data", (data: Buffer) => {
        if (plannedEnd || fault) return;
        if (!wait) { fail("Unexpected action"); return; }
        buffer += data.toString("utf8");
        if (buffer.length > 80) { fail("Action line is too long"); return; }
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const action = parseDeliveryAction(buffer.slice(0, newline).replace(/\r$/, ""));
        if (!action || newline !== buffer.length - 1) {
          fail("Expected exactly one valid action per turn");
          return;
        }
        buffer = "";
        finish({ action });
      });
      ready();
    },
  }).then(r => {
    if (!plannedEnd) {
      if (r.spawnErrorCode || (!fault && /^bwrap:/m.test(r.stderr))) {
        infrastructure = new Error("Unable to launch an isolated delivery bot");
      }
      fail(r.timedOut ? "Match time limit exceeded" : r.memoryLimitExceeded ?
        "Bot memory limit exceeded" : "Bot exited or exceeded its resource limit");
    }
  }).catch(() => {
    infrastructure = new Error("Delivery runner failed");
    fail("Delivery runner failed");
  }).finally(() => ready());

  return {
    async turn(observation: string, first: boolean): Promise<Turn> {
      await started;
      if (infrastructure) throw infrastructure;
      if (fault || !child?.stdin?.writable) return { fault: fault ?? "Bot exited before its action" };
      const result = await new Promise<Turn>(resolve => {
        wait = resolve;
        timer = setTimeout(() => fail("Turn timed out; flush the action"), first ? FIRST_TURN_MS : TURN_MS);
        child!.stdin!.write(observation);
      });
      if (infrastructure) throw infrastructure;
      return result;
    },
    async close() {
      plannedEnd = true;
      clearTimeout(timer);
      if (child?.stdin?.writable && !fault) child.stdin.end("END\n");
      const stop = setTimeout(() => controller.abort(), 400);
      try {
        await completed;
        if (infrastructure) throw infrastructure;
      } finally { clearTimeout(stop); }
    },
  };
}

export async function playDeliveryMatch(
  seed: number, flipped: boolean, sources: [DeliveryBotSource | null, DeliveryBotSource | null],
  options: { map?: DeliveryMap; versions?: [string | null, string | null]; queuedMs?: number } = {},
): Promise<DeliveryResult> {
  assertGameExecutionAllowed();
  await assertJudgeSandboxReady();
  const dirs: string[] = [];
  const game = new DeliveryGame(seed, flipped, undefined, options.map);
  const peers: [ReturnType<typeof spawnPeer> | null, ReturnType<typeof spawnPeer> | null] = [null, null];
  const faults: [string | null, string | null] = [null, null];
  const preparationStarted = performance.now();
  let playStarted: number | undefined, compileMs = 0, cacheHits = 0;
  const result = (): DeliveryResult => {
    const now = performance.now();
    return { ...game.result(faults), timing: { queuedMs: options.queuedMs ?? 0, compileMs, cacheHits,
      prepareMs: Math.round((playStarted ?? now) - preparationStarted), playMs: playStarted === undefined ? 0 : Math.round(now - playStarted) } };
  };
  try {
    const commands: [{ command: string; args: string[]; cwd: string } | null, { command: string; args: string[]; cwd: string } | null] = [null, null];
    for (const seat of [0, 1] as const) {
      const source = sources[seat];
      if (!source) continue;
      const cwd = await mkdtemp(path.join(os.tmpdir(), "ojp-delivery-"));
      dirs.push(cwd);
      await mkdir(path.join(cwd, "tmp"));
      const program = await stageJudgeProgram(cwd, source.language, source.sourceCode, MEMORY_MB);
      const sandbox = getJudgeSandboxMode();
      const { result: compile, cacheHit, compileMs: usedMs } = await compileDeliveryProgram(
        cwd, source.language, source.sourceCode, options.versions?.[seat] ?? null, sandbox, program.compile);
      compileMs += usedMs;
      cacheHits += Number(cacheHit);
      if (!compile.ok) {
        if (compile.verdict === "internal_error" || /^bwrap:/m.test(compile.message)) throw new Error("Delivery compiler infrastructure unavailable");
        faults[seat] = "Bot compilation failed";
        continue;
      }
      const env = createJudgeEnvironment(cwd, sandbox);
      const args = source.language === "brainfuck" ? [...program.execute.args, "--interactive"] : program.execute.args;
      for (const name of program.execute.commands) {
        if (await resolveJudgeExecutable(name, cwd, env)) {
          commands[seat] = { command: name, args, cwd };
          break;
        }
      }
      if (!commands[seat]) throw new Error("Delivery language runtime unavailable");
    }
    if (faults.some(Boolean)) return result();
    playStarted = performance.now();
    for (const seat of [0, 1] as const) {
      const run = commands[seat];
      if (run) peers[seat] = spawnPeer(run.command, run.args, run.cwd);
    }
    while (!game.done) {
      // Dispatch the same tick's observations before applying either action.
      const responses = await Promise.all(([0, 1] as const).map(async seat => {
        const peer = peers[seat];
        return peer ? peer.turn(game.observe(seat), game.turn === 1) : { action: standardDeliveryAction(game, seat) };
      }));
      const [a, b] = responses;
      if ("fault" in a || "fault" in b) {
        faults[0] = "fault" in a ? a.fault : null;
        faults[1] = "fault" in b ? b.fault : null;
        return result();
      }
      game.step([a.action, b.action]);
    }
    return result();
  } finally {
    try { await Promise.all(peers.map(peer => peer?.close())); }
    finally { await Promise.all(dirs.map(removeJudgeDirectory)); }
  }
}

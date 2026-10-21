import { config } from "dotenv";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertJudgeSandboxReady, getJudgeResourceLimits, runJudgeCommand } from "../lib/judge-process";
import { getJudgeSandboxMode } from "../lib/judge-sandbox";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const requested = process.argv.find((argument) => argument.startsWith("--sandbox="));
  if (requested) process.env.JUDGE_SANDBOX = requested.slice("--sandbox=".length);
  const mode = getJudgeSandboxMode();
  console.log(`Judge sandbox: ${mode}`);
  console.log(`Live process memory monitoring: ${process.platform === "linux" ? "enabled" : "unavailable on this OS"}`);
  if (mode === "basic") console.log("Basic mode does not isolate filesystem or network access.");
  await assertJudgeSandboxReady();
  console.log(`Resource limits: ${JSON.stringify(getJudgeResourceLimits())}`);
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ojp-judge-doctor-"));
  let missingTools = false;
  try {
    for (const [name, command, args] of [
      ["C++", "g++", ["--version"]],
      ["Python", "python3", ["--version"]],
      ["Java", "java", ["-version"]],
      ["JavaScript", process.execPath, ["--version"]],
    ] as const) {
      const result = await runJudgeCommand(command, [...args], {
        cwd, stdin: "", timeoutMs: 5000, captureMemory: false,
      });
      const available = result.exitCode === 0 && !result.spawnErrorCode;
      console.log(`${name}: ${available ? "available" : "unavailable"}`);
      missingTools ||= !available;
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  if (missingTools) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "judge diagnostics failed");
  process.exitCode = 1;
});

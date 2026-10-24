import { config } from "dotenv";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertJudgeSandboxReady, getJudgeResourceLimits, runJudgeCommand } from "../lib/judge-process";
import { getJudgeSandboxMode } from "../lib/judge-sandbox";
import { brainfuckNodeRunner } from "../lib/brainfuck-node";
import { BRAINFUCK_HELLO_WORLD } from "../lib/brainfuck.js";

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
      ["C", "gcc", ["--version"]],
      ["Rust", "rustc", ["--version"]],
      ["Go", "go", ["version"]],
      ["C# (Mono)", "mcs", ["--version"]],
      ["Kotlin", "java", ["-Xmx128m", "-XX:+UseSerialGC", "-XX:ActiveProcessorCount=1", "-Dkotlin.home=/usr/share/kotlin/kotlinc", "-cp", "/usr/share/kotlin/kotlinc/lib/*", "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-version"]],
      ["Ruby", "ruby", ["--version"]],
      ["PyPy3", "pypy3", ["--version"]],
    ] as const) {
      const result = await runJudgeCommand(command, [...args], {
        cwd, stdin: "", timeoutMs: 5000, captureMemory: false,
      });
      const available = result.exitCode === 0 && !result.spawnErrorCode;
      const version = (result.stdout || result.stderr).split(/\r?\n/).find((line) => line.trim() && !/warning|deprecated/i.test(line))?.trim();
      console.log(`${name}: ${available ? "available" : "unavailable"}${version ? ` (${version})` : ""}`);
      missingTools ||= !available;
    }
    await writeFile(path.join(cwd, "brainfuck-runtime.cjs"), brainfuckNodeRunner());
    await writeFile(path.join(cwd, "Main.bf"), BRAINFUCK_HELLO_WORLD);
    const brainfuck = await runJudgeCommand(process.execPath, ["brainfuck-runtime.cjs", "Main.bf"], {
      cwd, stdin: "", timeoutMs: 5000, captureMemory: false,
    });
    const available = brainfuck.exitCode === 0 && brainfuck.stdout === "Hello World!\n";
    console.log(`Brainfuck: ${available ? "available" : "unavailable"}`);
    missingTools ||= !available;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  if (missingTools) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "judge diagnostics failed");
  process.exitCode = 1;
});

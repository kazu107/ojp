import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { removeJudgeDirectory, runJudgeCommand } from "../lib/judge-process";

async function withWorkspace(action: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ojp-process-test-"));
  try { await action(cwd); }
  finally { await rm(cwd, { recursive: true, force: true }); }
}

test("submitted process cannot inherit secrets or interpreter injection variables", async () => {
  const names = ["DATABASE_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "AUTH_SECRET", "NODE_OPTIONS", "PYTHONPATH", "LD_PRELOAD"];
  const previous = names.map((name) => process.env[name]);
  for (const name of names) process.env[name] = "test-only-secret";
  try {
    await withWorkspace(async (cwd) => {
      const result = await runJudgeCommand(process.execPath, ["-e",
        `process.stdout.write(JSON.stringify(${JSON.stringify(names)}.filter(key => process.env[key] !== undefined)))`,
      ], { cwd, stdin: "", timeoutMs: 3000, captureMemory: false });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), []);
    });
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

test("stdout capture is bounded and excessive output stops the command", async () => {
  await withWorkspace(async (cwd) => {
    const result = await runJudgeCommand(process.execPath,
      ["-e", "process.stdout.write('x'.repeat(100000)); setInterval(() => {}, 1000)"],
      { cwd, stdin: "", timeoutMs: 3000, captureMemory: false, maxStdoutCaptureBytes: 4096 });
    assert.equal(result.outputLimitExceeded, true);
    assert.ok(Buffer.byteLength(result.stdout) <= 4096);
    assert.equal(result.timedOut, false);
  });
});

test("large valid output is streamed to a file rather than retained in memory", async () => {
  await withWorkspace(async (cwd) => {
    const output = path.join(cwd, "output.txt");
    const result = await runJudgeCommand(process.execPath, ["-e", `
      const chunk = Buffer.alloc(65536, 120);
      for (let i = 0; i < 112; i++) require('node:fs').writeSync(1, chunk);
    `], { cwd, stdin: "", timeoutMs: 3000, captureMemory: true, stdoutFilePath: output });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal((await stat(output)).size, 112 * 65536);
    assert.equal(result.outputLimitExceeded, false);
  });
});

test("stdout file limit stops a continuing producer", async () => {
  await withWorkspace(async (cwd) => {
    const output = path.join(cwd, "output.txt");
    const result = await runJudgeCommand(process.execPath, ["-e", `
      setInterval(() => require('node:fs').writeSync(1, Buffer.alloc(32768, 120)), 2);
    `], { cwd, stdin: "", timeoutMs: 3000, captureMemory: true, stdoutFilePath: output, outputLimitBytes: 65536 });
    assert.equal(result.outputLimitExceeded, true);
    assert.equal(result.timedOut, false);
    if (process.platform === "linux") assert.ok((await stat(output)).size <= 65536);
  });
});

test("timeout terminates children, not only the main submitted process", async () => {
  await withWorkspace(async (cwd) => {
    const result = await runJudgeCommand(process.execPath, ["-e", `
      require('node:child_process').spawn(process.execPath, ['-e',
        "setTimeout(() => require('node:fs').writeFileSync('escaped.txt', 'bad'), 3000)"
      ], { stdio: 'ignore' });
      require('node:fs').writeFileSync('started.txt', 'yes');
      setInterval(() => {}, 1000);
    `], { cwd, stdin: "", timeoutMs: 1500, captureMemory: false });
    assert.equal(result.timedOut, true);
    assert.equal(await readFile(path.join(cwd, "started.txt"), "utf8"), "yes");
    await new Promise((resolve) => setTimeout(resolve, 1900));
    assert.equal(existsSync(path.join(cwd, "escaped.txt")), false);
  });
});

test("Linux also removes descendants after a successful main-process exit", {
  skip: process.platform !== "linux",
}, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runJudgeCommand(process.execPath, ["-e", `
      require('node:child_process').spawn(process.execPath, ['-e',
        "setTimeout(() => require('node:fs').writeFileSync('escaped.txt', 'bad'), 600)"
      ], { stdio: 'inherit' });
      setTimeout(() => process.exit(0), 100);
    `], { cwd, stdin: "", timeoutMs: 3000, captureMemory: true });
    assert.equal(result.exitCode, 0, result.stderr);
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(existsSync(path.join(cwd, "escaped.txt")), false);
  });
});

test("workspace growth is bounded independently from stdout", async () => {
  await withWorkspace(async (cwd) => {
    const result = await runJudgeCommand(process.execPath, ["-e", `
      let index = 0;
      setInterval(() => require('node:fs').writeFileSync('file-' + index++, Buffer.alloc(4096)), 10);
    `], { cwd, stdin: "", timeoutMs: 3000, captureMemory: false, workspaceLimitBytes: 16384 });
    assert.equal(result.workspaceLimitExceeded, true);
    assert.equal(result.timedOut, false);
  });
});

test("Linux stops growing resident memory before the wall-clock deadline", {
  skip: process.platform !== "linux",
}, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runJudgeCommand(process.execPath, ["-e", `
      const chunks = [];
      setInterval(() => chunks.push(Buffer.alloc(8 * 1024 * 1024, 1)), 30);
    `], { cwd, stdin: "", timeoutMs: 3000, captureMemory: true, memoryLimitMb: 80 });
    assert.equal(result.memoryLimitExceeded, true);
    assert.ok(result.memoryKb > 80 * 1024);
    assert.equal(result.timedOut, false);
  });
});

test("cleanup removes directories even when the submitted program made them unreadable", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ojp-cleanup-test-"));
  const locked = path.join(cwd, "locked");
  await mkdir(locked);
  await writeFile(path.join(locked, "leftover.txt"), "test");
  await chmod(locked, 0);
  try {
    await removeJudgeDirectory(cwd);
    assert.equal(existsSync(cwd), false);
  } finally {
    await removeJudgeDirectory(cwd);
  }
});

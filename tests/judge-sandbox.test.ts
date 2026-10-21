import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildBubblewrapArguments,
  createJudgeEnvironment,
  getJudgeSandboxMode,
} from "../lib/judge-sandbox";
import { assertJudgeSandboxReady, runJudgeCommand } from "../lib/judge-process";

test("environment is allowlisted rather than inherited", () => {
  const env = createJudgeEnvironment("/workspace", "basic", {
    NODE_ENV: "development", PATH: "/usr/bin", SystemRoot: "C:\\Windows",
    DATABASE_URL: "test-only-secret", R2_SECRET_ACCESS_KEY: "test-only-secret",
    AUTH_SECRET: "test-only-secret", NODE_OPTIONS: "--require forbidden.js",
    PYTHONPATH: "/private/site-packages", LD_PRELOAD: "/private/injection.so",
  });
  for (const name of ["DATABASE_URL", "R2_SECRET_ACCESS_KEY", "AUTH_SECRET", "NODE_OPTIONS", "PYTHONPATH", "LD_PRELOAD"]) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.HOME, "/workspace");
  assert.equal(env.PYTHONNOUSERSITE, "1");
});

test("bubblewrap mounts only runtime, own workspace, and explicitly allowed case files", () => {
  const args = buildBubblewrapArguments({
    executable: "/jobs/own/main", cwd: "/jobs/own", tempDir: "/private/temporary",
    args: ["/private/answer.txt"], env: createJudgeEnvironment("/jobs/own", "bubblewrap"),
    systemPaths: ["/usr", "/lib"],
    readOnlyFiles: [{ source: "/private/answer.txt", destination: "/cases/answer.txt" }],
    resourceWrapper: { executable: "/usr/bin/prlimit", args: ["--nproc=128"] },
  });
  assert.ok(args.includes("--unshare-all"));
  assert.ok(args.includes("--new-session"));
  assert.ok(args.includes("--clearenv"));
  assert.ok(args.includes("--die-with-parent"));
  assert.ok(!args.includes("/app"));
  const executableIndex = args.lastIndexOf("--");
  assert.deepEqual(args.slice(executableIndex + 1), ["/workspace/main", "/cases/answer.txt"]);
  assert.ok(args.join(" ").includes("-- /usr/bin/prlimit --nproc=128 -- /workspace/main"));
  assert.ok(args.join(" ").includes("--ro-bind /private/answer.txt /cases/answer.txt"));
  assert.ok(args.join(" ").includes("--remount-ro /"));
});

test("requested isolation never silently falls back on unsupported operating systems", {
  skip: process.platform === "linux",
}, async () => {
  const previous = process.env.JUDGE_SANDBOX;
  process.env.JUDGE_SANDBOX = "bubblewrap";
  try {
    await assert.rejects(assertJudgeSandboxReady, /requires a Linux judge worker/);
  } finally {
    if (previous === undefined) delete process.env.JUDGE_SANDBOX;
    else process.env.JUDGE_SANDBOX = previous;
  }
});

test("isolated execution cannot read sibling files and checker input mounts are read-only", {
  skip: process.platform !== "linux" || getJudgeSandboxMode() !== "bubblewrap",
}, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "ojp-isolation-test-"));
  const cwd = await mkdtemp(path.join(parent, "workspace-"));
  const hidden = path.join(parent, "hidden.txt");
  const answer = path.join(parent, "answer.txt");
  await writeFile(hidden, "must not be visible");
  await writeFile(answer, "5\n");
  try {
    const source = `
      const fs = require('node:fs');
      if (fs.existsSync(${JSON.stringify(hidden)})) process.exit(2);
      if (process.getuid() !== 65534) process.exit(3);
      if (fs.readFileSync(process.argv[1], 'utf8') !== '5\\n') process.exit(4);
      try { fs.writeFileSync(process.argv[1], 'changed'); process.exit(5); } catch {}
      process.stdout.write('protected');
    `;
    const result = await runJudgeCommand(process.execPath, ["-e", source, answer], {
      cwd, stdin: "", timeoutMs: 3000, captureMemory: true,
      readOnlyFiles: [{ source: answer, destination: "/cases/answer.txt" }],
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "protected");
    assert.equal(await readFile(answer, "utf8"), "5\n");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("isolated execution cannot reach a host TCP listener", {
  skip: process.platform !== "linux" || getJudgeSandboxMode() !== "bubblewrap",
}, async () => {
  const { createServer } = await import("node:net");
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ojp-network-test-"));
  try {
    const source = `
      const socket = require('node:net').connect(${port}, '127.0.0.1');
      socket.on('connect', () => process.exit(2));
      socket.on('error', () => { process.stdout.write('isolated'); socket.destroy(); });
      socket.setTimeout(500, () => { process.stdout.write('isolated'); socket.destroy(); });
    `;
    const result = await runJudgeCommand(process.execPath, ["-e", source], {
      cwd, stdin: "", timeoutMs: 3000, captureMemory: true,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "isolated");
  } finally {
    server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

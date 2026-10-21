import assert from "node:assert/strict";
import test from "node:test";
import { collectJudgeHostProbe } from "../scripts/judge-host-probe.mjs";
import { buildHerokuProbeArguments, parseHerokuProbeReport } from "../scripts/judge-heroku-probe.mjs";

function linux(spawn, settings = {}) {
  return collectJudgeHostProbe({
    platform: "linux", kernel: "test-kernel",
    environment: { DATABASE_URL: "test-only-secret", R2_SECRET_ACCESS_KEY: "test-only-secret" },
    exists: (file) => file.endsWith("/unshare"),
    read: (file) => settings[file] ?? "NoNewPrivs:\t1\nSeccomp:\t2\n",
    spawn,
  });
}

test("non-Linux hosts cannot report namespace isolation available", () => {
  const report = collectJudgeHostProbe({ platform: "win32", kernel: "test-kernel",
    spawn: () => assert.fail("must not spawn"), read: () => assert.fail("must not read proc") });
  assert.equal(report.namespaceIsolationAvailable, false);
});

test("a denied user namespace blocks isolation and child tools receive no secrets", () => {
  let probes = 0;
  const report = linux((command, args, options) => {
    probes++;
    assert.equal(command, "/usr/bin/unshare");
    assert.equal(args.at(-1), "/usr/bin/id");
    assert.equal(options.env.DATABASE_URL, undefined);
    assert.equal(options.env.R2_SECRET_ACCESS_KEY, undefined);
    return { status: 1, stdout: "", stderr: "unshare: Permission denied" };
  }, { "/proc/sys/kernel/unprivileged_userns_clone": "0" });
  assert.equal(probes, 1);
  assert.equal(report.unprivilegedUserNamespaces, "0");
  assert.equal(report.namespaceIsolationAvailable, false);
  assert.equal(report.noNewPrivs, "1");
  assert.equal(report.seccomp, "2");
});

test("user namespace success alone does not validate mount, PID, and network isolation", () => {
  const report = linux((command, args) => ({ status: args.includes("--net") ? 1 : 0, stdout: "", stderr: "" }));
  assert.equal(report.userNamespaceProbe.status, 0);
  assert.equal(report.namespaceIsolationAvailable, false);
});

test("successful probes explicitly report prerequisites, not a validated full sandbox", () => {
  const report = linux(() => ({ status: 0, stdout: "uid=0", stderr: "" }));
  assert.equal(report.namespaceIsolationAvailable, true);
  assert.equal(report.bubblewrapInstalled, false);
  assert.equal(report.scope, "namespace_prerequisites_only");
});

test("Heroku probe uses the worker image without unsupported exit-code handling", () => {
  const args = buildHerokuProbeArguments("ojp", "export function printJudgeHostProbe() {}");
  assert.ok(args.includes("worker"));
  assert.ok(!args.includes("--exit-code"));
  assert.ok(args[1].includes("data:text/javascript;base64,"));
  assert.throws(() => buildHerokuProbeArguments("ojp;bad", ""), /valid --app/);
});

test("missing or malformed Heroku output never implies isolation was verified", () => {
  assert.throws(() => parseHerokuProbeReport("command parsing error"), /did not return/);
  assert.throws(() => parseHerokuProbeReport('OJP_JUDGE_HOST_PROBE={"schemaVersion":1}'), /invalid/);
  const report = { schemaVersion: 1, scope: "namespace_prerequisites_only", namespaceIsolationAvailable: false };
  assert.deepEqual(parseHerokuProbeReport(`progress\nOJP_JUDGE_HOST_PROBE=${JSON.stringify(report)}\n`), report);
});

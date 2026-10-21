import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function collectJudgeHostProbe(dependencies = {}) {
  const {
    platform = process.platform,
    kernel = os.release(),
    environment = process.env,
    read = readFileSync,
    exists = existsSync,
    spawn = spawnSync,
  } = dependencies;
  const report = {
    schemaVersion: 1,
    scope: "namespace_prerequisites_only",
    platform,
    kernel,
    configuredSandbox: ["basic", "bubblewrap"].includes(environment.JUDGE_SANDBOX)
      ? environment.JUDGE_SANDBOX : "basic",
    bubblewrapInstalled: false,
    userNamespaceProbe: null,
    combinedNamespaceProbe: null,
    namespaceIsolationAvailable: false,
  };
  if (platform !== "linux") {
    report.reason = "Linux is required for the namespace sandbox";
    return report;
  }
  const setting = (file) => {
    try { return read(file, "utf8").trim(); }
    catch (error) { return error.code ?? "unavailable"; }
  };
  report.unprivilegedUserNamespaces = setting("/proc/sys/kernel/unprivileged_userns_clone");
  report.maxUserNamespaces = setting("/proc/sys/user/max_user_namespaces");
  const status = setting("/proc/self/status");
  report.noNewPrivs = status.match(/^NoNewPrivs:\s+(\d+)/m)?.[1] ?? null;
  report.seccomp = status.match(/^Seccomp:\s+(\d+)/m)?.[1] ?? null;
  report.bubblewrapInstalled = ["/usr/bin/bwrap", "/bin/bwrap"].some(exists);
  const unshare = ["/usr/bin/unshare", "/bin/unshare"].find(exists);
  if (!unshare) {
    report.reason = "unshare is not installed; namespace support was not verified";
    return report;
  }
  const probe = (args) => {
    const result = spawn(unshare, [...args, "/usr/bin/id"], {
      encoding: "utf8", timeout: 5000, maxBuffer: 8192,
      // Only trusted system tools run, and they do not need application credentials.
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    });
    return {
      status: result.status,
      errorCode: result.error?.code ?? null,
      stdout: (result.stdout ?? "").trim().slice(0, 512),
      stderr: (result.stderr ?? "").trim().slice(0, 2048),
    };
  };
  report.userNamespaceProbe = probe(["--user", "--map-root-user"]);
  if (report.userNamespaceProbe.status !== 0 || report.userNamespaceProbe.errorCode) {
    report.reason = "The worker refused creation of an unprivileged user namespace";
    return report;
  }
  report.combinedNamespaceProbe = probe([
    "--user", "--map-root-user", "--mount", "--net", "--pid", "--ipc", "--uts", "--fork",
  ]);
  report.namespaceIsolationAvailable = report.combinedNamespaceProbe.status === 0 &&
    report.combinedNamespaceProbe.errorCode === null;
  report.reason = report.namespaceIsolationAvailable
    ? "Namespace prerequisites passed; run judge:doctor and judge tests before enabling isolation"
    : "The worker refused one or more mount, network, or process namespaces";
  return report;
}

export function printJudgeHostProbe() {
  const report = collectJudgeHostProbe();
  console.log(`OJP_JUDGE_HOST_PROBE=${JSON.stringify(report)}`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = printJudgeHostProbe().namespaceIsolationAvailable ? 0 : 1;
}

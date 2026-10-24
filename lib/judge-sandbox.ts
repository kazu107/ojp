import { existsSync, readdirSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import path from "node:path";

export type JudgeSandboxMode = "basic" | "bubblewrap";

export interface JudgeReadOnlyFile {
  source: string;
  destination: string;
}

export function getJudgeSandboxMode(): JudgeSandboxMode {
  const mode = process.env.JUDGE_SANDBOX?.trim() || "basic";
  if (mode !== "basic" && mode !== "bubblewrap") {
    throw new Error("JUDGE_SANDBOX must be basic or bubblewrap");
  }
  return mode;
}

export function createJudgeEnvironment(
  cwd: string,
  sandboxMode: JudgeSandboxMode,
  parent: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const isolated = sandboxMode === "bubblewrap";
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    PATH: process.platform === "win32"
      ? parent.PATH ?? parent.Path ?? ""
      : `${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    HOME: isolated ? "/workspace" : cwd,
    TMPDIR: isolated ? "/tmp" : cwd,
    TEMP: isolated ? "/tmp" : cwd,
    TMP: isolated ? "/tmp" : cwd,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    PYTHONNOUSERSITE: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    OMP_NUM_THREADS: "1",
    OPENBLAS_NUM_THREADS: "1",
    MKL_NUM_THREADS: "1",
    NUMEXPR_NUM_THREADS: "1",
    UV_THREADPOOL_SIZE: "1",
    GOMAXPROCS: "1",
    GO111MODULE: "off",
    GOENV: "off",
    GOPROXY: "off",
    GOSUMDB: "off",
    CGO_ENABLED: "0",
    MONO_THREADS_PER_CPU: "1",
  };
  if (process.platform === "win32") {
    env.SystemRoot = parent.SystemRoot ?? parent.SYSTEMROOT ?? "C:\\Windows";
    env.WINDIR = env.SystemRoot;
    env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
  }
  return env;
}

export async function resolveJudgeExecutable(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const candidates = command.includes("/") || command.includes("\\")
    ? [path.resolve(cwd, command)]
    : (env.PATH ?? "").split(path.delimiter)
      .filter(Boolean)
      .flatMap((directory) => process.platform === "win32" && !path.extname(command)
        ? [command, `${command}.exe`, `${command}.com`].map((name) => path.join(directory, name))
        : [path.join(directory, command)]);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed toolchain executable.
    }
  }
  return null;
}

export function buildBubblewrapArguments(input: {
  executable: string;
  args: string[];
  cwd: string;
  tempDir: string;
  env: NodeJS.ProcessEnv;
  readOnlyFiles?: JudgeReadOnlyFile[];
  resourceWrapper?: { executable: string; args: string[] };
  systemPaths?: string[];
}): string[] {
  const args = [
    "--unshare-all", "--unshare-user", "--die-with-parent", "--new-session",
    "--cap-drop", "ALL", "--uid", "65534", "--gid", "65534",
    "--clearenv",
  ];
  const systemPaths = input.systemPaths ?? [
    "/usr", "/bin", "/sbin", "/lib", "/lib64",
    "/etc/alternatives", "/etc/ld.so.cache", "/etc/localtime",
    "/etc/mono",
    // Debian's JDK conf directory points outside /usr into its system configuration.
    ...readdirSync("/etc", { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^java-\d+-openjdk$/.test(entry.name))
      .map((entry) => `/etc/${entry.name}`),
  ].filter((systemPath) => existsSync(systemPath));
  for (const systemPath of systemPaths) {
    args.push("--ro-bind", systemPath, systemPath);
  }
  // Node may live outside /usr when installed by a CI runner or a local version manager.
  if (!systemPaths.some((root) => input.executable.startsWith(`${root}/`)) &&
      !input.executable.startsWith(`${input.cwd}/`)) {
    args.push("--ro-bind", input.executable, input.executable);
  }
  args.push("--proc", "/proc", "--remount-ro", "/proc", "--tmpfs", "/dev");
  for (const device of ["null", "zero", "random", "urandom"]) {
    args.push("--dev-bind", `/dev/${device}`, `/dev/${device}`);
  }
  args.push("--dir", "/dev/shm", "--symlink", "/proc/self/fd", "/dev/fd");
  for (const [name, fd] of [["stdin", 0], ["stdout", 1], ["stderr", 2]] as const) {
    args.push("--symlink", `/proc/self/fd/${fd}`, `/dev/${name}`);
  }
  args.push("--remount-ro", "/dev");
  args.push("--bind", input.tempDir, "/tmp", "--dir", "/cases");
  args.push("--bind", input.cwd, "/workspace", "--chdir", "/workspace");
  const pathMap = new Map<string, string>();
  for (const file of input.readOnlyFiles ?? []) {
    args.push("--ro-bind", file.source, file.destination);
    pathMap.set(file.source, file.destination);
  }
  for (const [key, value] of Object.entries(input.env)) {
    if (value !== undefined) {
      args.push("--setenv", key, value);
    }
  }
  const executable = input.executable.startsWith(`${input.cwd}/`)
    ? `/workspace/${path.posix.relative(input.cwd, input.executable)}`
    : input.executable;
  const wrappedCommand = input.resourceWrapper
    ? [input.resourceWrapper.executable, ...input.resourceWrapper.args, "--", executable]
    : [executable];
  return [...args, "--remount-ro", "/", "--", ...wrappedCommand,
    ...input.args.map((argument) => pathMap.get(argument) ?? argument)];
}

export function resolveBubblewrap(): string {
  if (process.platform !== "linux") {
    throw new Error("JUDGE_SANDBOX=bubblewrap requires a Linux judge worker");
  }
  const command = ["/usr/bin/bwrap", "/bin/bwrap"].find((candidate) => existsSync(candidate));
  if (!command) {
    throw new Error("bubblewrap is not installed; install it on the judge worker");
  }
  return command;
}

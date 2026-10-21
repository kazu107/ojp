import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function buildHerokuProbeArguments(app, source) {
  if (!/^[a-z][a-z0-9-]{0,29}$/.test(app)) throw new Error("A valid --app name is required");
  const encoded = Buffer.from(source, "utf8").toString("base64");
  const command = `node -e "import('data:text/javascript;base64,${encoded}').then(m=>m.printJudgeHostProbe())"`;
  // --exit-code inserts a non-ASCII sentinel unsupported by Heroku's container command parser.
  return ["run", command, "--app", app, "--no-tty", "--no-notify", "--type", "worker"];
}

export function parseHerokuProbeReport(output) {
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith("OJP_JUDGE_HOST_PROBE="));
  if (!line) throw new Error("The dyno did not return a host probe report; isolation was not verified");
  const report = JSON.parse(line.slice("OJP_JUDGE_HOST_PROBE=".length));
  if (report?.schemaVersion !== 1 || report.scope !== "namespace_prerequisites_only" ||
      typeof report.namespaceIsolationAvailable !== "boolean") {
    throw new Error("The dyno returned an invalid host probe report");
  }
  return report;
}

function resolveHerokuCli() {
  if (process.platform !== "win32") return { command: "heroku", prefix: [] };
  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "heroku"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "heroku"),
  ].filter(Boolean);
  for (const root of roots) {
    const entry = path.join(root, "client", "bin", "run");
    const bundledNode = path.join(root, "client", "bin", "node.exe");
    if (existsSync(entry) && existsSync(bundledNode)) {
      // Invoke the native executable directly to avoid cmd.exe re-parsing shell quotes.
      return { command: bundledNode, prefix: [entry] };
    }
  }
  throw new Error("The Heroku Windows CLI was not found in its standard installation paths");
}

function main() {
  const appIndex = process.argv.indexOf("--app");
  const app = appIndex >= 0 ? process.argv[appIndex + 1] : undefined;
  if (!app) throw new Error("Usage: npm run judge:probe:heroku -- --app APP_NAME");
  const source = readFileSync(fileURLToPath(new URL("./judge-host-probe.mjs", import.meta.url)), "utf8");
  const cli = resolveHerokuCli();
  console.log(`Checking namespace prerequisites in ${app}'s worker image. No application data or config is changed.`);
  const output = execFileSync(cli.command, [...cli.prefix, ...buildHerokuProbeArguments(app, source)], {
    encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HEROKU_NOTIFICATIONS: "0" },
  });
  const report = parseHerokuProbeReport(output);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.namespaceIsolationAvailable ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    console.error(error.code === "ETIMEDOUT" ? "The Heroku probe timed out; isolation was not verified" : error.message);
    process.exitCode = 1;
  }
}

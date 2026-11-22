import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { buildProblemPackageZip } from "../lib/problem-package";
import {
  gridGameExample,
  gridGameOracle,
  gridGamePythonSolution,
} from "../lib/grid-game-examples";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: npm run template:game-zip -- [output-directory] [--force]",
    );
    return;
  }
  if (
    args.some((arg) => arg.startsWith("--") && arg !== "--force") ||
    args.filter((arg) => !arg.startsWith("--")).length > 1
  )
    throw new Error("Invalid arguments; use --help");
  const force = args.includes("--force"),
    folder = path.resolve(
      args.find((arg) => !arg.startsWith("--")) ??
        "recovered/grid-game-examples",
    );
  await mkdir(folder, { recursive: true });
  if (!force)
    for (const kind of ["maze", "treasure"])
      for (const protocol of ["turns", "moves"])
        for (const suffix of [".zip", "-solution.py", "-oracle.json"]) {
          const file = path.join(folder, `grid-${kind}-${protocol}${suffix}`);
          let exists = false;
          try {
            await access(file);
            exists = true;
          } catch {}
          if (exists)
            throw new Error(
              `File already exists: ${file}; use --force only to overwrite generated examples`,
            );
        }
  for (const kind of ["maze", "treasure"] as const)
    for (const protocol of ["turns", "moves"] as const) {
      const example = gridGameExample(kind, protocol),
        prefix = `grid-${kind}-${protocol}`;
      await writeFile(
        path.join(folder, prefix + ".zip"),
        buildProblemPackageZip(example),
        { flag: force ? "w" : "wx" },
      );
      await writeFile(
        path.join(folder, prefix + "-solution.py"),
        gridGamePythonSolution(kind, protocol),
        { flag: force ? "w" : "wx" },
      );
      const scores = example.draft.groups.flatMap((g) =>
        g.tests.map((c) => ({
          case: g.name + "/" + c.name,
          score: gridGameOracle(c.input, kind),
        })),
      );
      await writeFile(
        path.join(folder, prefix + "-oracle.json"),
        JSON.stringify(scores, null, 2),
        { flag: force ? "w" : "wx" },
      );
      console.log(
        `Created ${prefix}: 1 public sample, 3 provisional cases, 3 system cases`,
      );
    }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

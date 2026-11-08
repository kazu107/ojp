import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHeuristicExample, oracleScore } from "../lib/heuristic-examples";
async function main() {
  const index = process.argv.indexOf("--output");
  const directory = path.resolve(
    index >= 0 ? process.argv[index + 1] : "recovered/heuristic-examples",
  );
  await mkdir(directory, { recursive: true });
  for (const kind of ["knapsack", "route"] as const) {
    const example = createHeuristicExample(kind);
    await writeFile(path.join(directory, `heuristic-${kind}.zip`), example.zip);
    for (const [name, source] of Object.entries(example.solutions))
      await writeFile(path.join(directory, `${kind}-${name}.py`), source);
    await writeFile(
      path.join(directory, `${kind}-oracle.json`),
      JSON.stringify(
        example.draft.groups.flatMap((g) =>
          g.tests.map((c) => ({
            case: `${g.name}/${c.name}`,
            seed: example.draft.heuristic!.seeds[`${g.name}/${c.name}`],
            optimal: oracleScore(kind, c.input),
          })),
        ),
        null,
        2,
      ),
    );
    console.log(`${kind}: 10 provisional + 30 system cases, 4 solutions`);
  }
  console.log(`Generated examples in ${directory}`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import { buildProblemPackageZip } from "./problem-package";
import type { ProblemPackageEditorDraft } from "./problem-package-types";
import { DEFAULT_HEURISTIC_CONFIG } from "./heuristic-config";

export const KNAPSACK_SCORER = `import sys, json
from pathlib import Path
data = list(map(int, Path(sys.argv[1]).read_text().split()))
n, capacity = data[:2]
items = list(zip(data[2::2], data[3::2]))
if len(items) != n: raise ValueError("Bad judge input")
valid, score = False, 0
try:
    chosen = list(map(int, Path(sys.argv[3]).read_text().split()))
    valid = len(chosen) == n and all(x in (0,1) for x in chosen)
    if valid:
        weight = sum(w*x for (w,v),x in zip(items,chosen))
        score = sum(v*x for (w,v),x in zip(items,chosen))
        valid = weight <= capacity
except ValueError: pass
print(json.dumps({"version":1,"valid":valid,"score":str(score) if valid else None}))
`;
export const ROUTE_SCORER = `import sys, json
from pathlib import Path
data = list(map(int, Path(sys.argv[1]).read_text().split()))
n = data[0]
points = list(zip(data[1::2],data[2::2]))
if len(points) != n: raise ValueError("Bad judge input")
valid, score = False, 0
try:
    order = list(map(int, Path(sys.argv[3]).read_text().split()))
    valid = len(order) == n and sorted(order) == list(range(n))
    if valid:
        score = sum(abs(points[order[i]][0]-points[order[(i+1)%n]][0])+abs(points[order[i]][1]-points[order[(i+1)%n]][1]) for i in range(n))
except ValueError: pass
print(json.dumps({"version":1,"valid":valid,"score":str(score) if valid else None}))
`;
const knapsackPrelude = `import sys\na=list(map(int,sys.stdin.read().split()))\nn,c=a[:2]\nitems=list(zip(a[2::2],a[3::2]))\n`;
const routePrelude = `import sys,itertools\na=list(map(int,sys.stdin.read().split()))\nn=a[0]\np=list(zip(a[1::2],a[2::2]))\n`;
export const HEURISTIC_SOLUTIONS = {
  knapsack: {
    baseline: knapsackPrelude + `print(*([0]*n))\n`,
    greedy:
      knapsackPrelude +
      `chosen=[0]*n\nfor i in sorted(range(n),key=lambda i:items[i][1]/items[i][0],reverse=True):\n w,v=items[i]\n if w<=c: chosen[i]=1;c-=w\nprint(*chosen)\n`,
    optimal:
      knapsackPrelude +
      `dp={0:(0,0)}\nfor i,(w,v) in enumerate(items):\n for weight,(value,mask) in list(dp.items()):\n  if weight+w<=c and dp.get(weight+w,(-1,0))[0]<value+v:dp[weight+w]=(value+v,mask|(1<<i))\nvalue,mask=max(dp.values())\nprint(*[(mask>>i)&1 for i in range(n)])\n`,
    invalid: knapsackPrelude + `print(*([2]*n))\n`,
  },
  route: {
    baseline: routePrelude + `print(*range(n))\n`,
    greedy:
      routePrelude +
      `order=[0];remaining=set(range(1,n))\nwhile remaining:\n q=min(remaining,key=lambda j:abs(p[order[-1]][0]-p[j][0])+abs(p[order[-1]][1]-p[j][1]))\n order.append(q);remaining.remove(q)\nprint(*order)\n`,
    optimal:
      routePrelude +
      `def distance(order):\n return sum(abs(p[order[i]][0]-p[order[(i+1)%n]][0])+abs(p[order[i]][1]-p[order[(i+1)%n]][1]) for i in range(n))\nbest=min(((0,)+q for q in itertools.permutations(range(1,n))),key=distance)\nprint(*best)\n`,
    invalid: routePrelude + `print(*([0]*n))\n`,
  },
};
export function exampleInput(kind: "knapsack" | "route", seed: number) {
  let state = seed >>> 0;
  const next = (max: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
  if (kind === "knapsack")
    return `12 35\n${Array.from({ length: 12 }, () => `${1 + next(15)} ${1 + next(40)}`).join("\n")}\n`;
  const points = new Set<string>();
  while (points.size < 7) points.add(`${next(101)} ${next(101)}`);
  return `7\n${[...points].join("\n")}\n`;
}
export function oracleScore(kind: "knapsack" | "route", input: string) {
  const a = input.trim().split(/\s+/).map(Number),
    n = a[0];
  if (kind === "knapsack") {
    let best = 0;
    for (let mask = 0; mask < 1 << n; mask++) {
      let w = 0,
        v = 0;
      for (let i = 0; i < n; i++)
        if (mask & (1 << i)) {
          w += a[2 + 2 * i];
          v += a[3 + 2 * i];
        }
      if (w <= a[1]) best = Math.max(best, v);
    }
    return best;
  }
  const d = (i: number, j: number) =>
    Math.abs(a[1 + 2 * i] - a[1 + 2 * j]) +
    Math.abs(a[2 + 2 * i] - a[2 + 2 * j]);
  // Held-Karp DP is independent of the reference submission's permutation search.
  const dp = new Map<string, number>();
  dp.set("1:0", 0);
  for (let mask = 1; mask < 1 << n; mask += 2)
    for (let last = 0; last < n; last++) {
      const value = dp.get(`${mask}:${last}`);
      if (value === undefined) continue;
      for (let j = 1; j < n; j++)
        if (!(mask & (1 << j))) {
          const key = `${mask | (1 << j)}:${j}`;
          dp.set(key, Math.min(dp.get(key) ?? Infinity, value + d(last, j)));
        }
    }
  return Math.min(
    ...Array.from(
      { length: n - 1 },
      (_, i) => (dp.get(`${(1 << n) - 1}:${i + 1}`) ?? Infinity) + d(i + 1, 0),
    ),
  );
}
export function createHeuristicExample(
  kind: "knapsack" | "route",
  counts = { provisional: 10, system: 30 },
) {
  const title = kind === "knapsack" ? "荷物詰めスコアアタック" : "点を巡る経路";
  const seeds: Record<string, string> = {};
  const groups = [
    { name: "provisional", count: counts.provisional, offset: 100 },
    { name: "system", count: counts.system, offset: 10000 },
  ].map(({ name, count, offset }, index) => ({
    id: name,
    name,
    score: null,
    tests: Array.from({ length: count }, (_, i) => {
      const caseName = `case${String(i + 1).padStart(2, "0")}`,
        seed = offset + i;
      seeds[`${name}/${caseName}`] = String(seed);
      return {
        id: `${name}-${i}`,
        name: caseName,
        input: exampleInput(kind, seed),
        output: "",
      };
    }),
    orderIndex: index,
  }));
  const sampleInput = exampleInput(kind, 1),
    sampleN = Number(sampleInput.split(/\s/)[0]);
  const sampleOutput =
    kind === "knapsack"
      ? Array(sampleN).fill(0).join(" ")
      : Array.from({ length: sampleN }, (_, i) => i).join(" ");
  const draft: ProblemPackageEditorDraft = {
    sourceLabel: `heuristic-${kind}.zip`,
    checkerType: "heuristic",
    checkerLanguage: "python",
    checkerSourceCode: kind === "knapsack" ? KNAPSACK_SCORER : ROUTE_SCORER,
    compareMode: "exact",
    heuristic: {
      ...DEFAULT_HEURISTIC_CONFIG,
      direction: kind === "knapsack" ? "maximize" : "minimize",
      finalGroups: ["system"],
      visualizer: kind,
      seeds,
    },
    zipSizeBytes: 0,
    fileCount: 0,
    warnings: [],
    groups,
    samples: [1, 2].map((seed) => ({
      id: `sample${seed}`,
      name: `sample${seed}`,
      input: seed === 1 ? sampleInput : exampleInput(kind, seed),
      output: sampleOutput + "\n",
      description:
        kind === "knapsack"
          ? "0は選ばない、1は選ぶことを表します。何も選ばない解も有効で、得点は0です。"
          : "入力順に点を巡り、最後に最初の点へ戻る経路です。添字は0始まりです。",
    })),
  };
  const settings = {
    title,
    slug: `heuristic-${kind}`,
    visibility: "unlisted" as const,
    explanationVisibility: "always" as const,
    difficulty: null,
    testCaseVisibility: "case_index_only" as const,
    statementMarkdown:
      kind === "knapsack"
        ? "容量を超えないよう荷物を選び、価値の合計をできるだけ大きくしてください。ACは有効な解を意味し、最適解である必要はありません。"
        : "全点を一度ずつ巡って出発点へ戻る経路を出力し、マンハッタン距離の合計をできるだけ小さくしてください。ACは有効な解を意味します。",
    inputDescription:
      kind === "knapsack"
        ? "N C\n続いてN行に重さwと価値v。"
        : "N\n続いてN行に座標x y。",
    outputDescription:
      kind === "knapsack"
        ? "N個の0または1を空白区切りで出力。"
        : "0からN-1の順列を空白区切りで出力。",
    constraintsMarkdown:
      kind === "knapsack"
        ? "N = 12, C = 35, 1 <= w <= 15, 1 <= v <= 40"
        : "N = 7, 0 <= x,y <= 100。点は相異なる。",
    explanationMarkdown:
      kind === "knapsack"
        ? "価値/重さの貪欲法より、DPで最適な組合せを求めると改善できます。"
        : "入力順、最近傍法、局所改善、全探索を比較できます。",
    timeLimitMs: 3000,
    memoryLimitMb: 256,
    tags: ["heuristic", kind],
    draft,
  };
  return {
    settings,
    draft,
    zip: buildProblemPackageZip(settings),
    solutions: HEURISTIC_SOLUTIONS[kind],
  };
}

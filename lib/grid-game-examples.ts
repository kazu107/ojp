import {
  DEFAULT_BOARD_CONFIG,
  DEFAULT_GRID_GAME,
  type GridGameConfig,
} from "./board-visualization";
import { DEFAULT_HEURISTIC_CONFIG } from "./heuristic-config";
import type { ProblemPackageEditorDraft } from "./problem-package-types";
import { GRID_GAME_CHECKER_MARKER } from "./grid-game-templates";

const MAZE = [
  "5 8\n########\n#S....G#\n#.###..#\n#......#\n########\n",
  "7 9\n#########\n#S#....G#\n#.#.###.#\n#...#...#\n###.#.#.#\n#.......#\n#########\n",
];
const TREASURE = [
  "5 8\n########\n#S..o.G#\n#.#.#..#\n#......#\n########\n",
  "7 9\n#########\n#S..#..G#\n#.#.#.#.#\n#o..o...#\n#.#.###.#\n#...o...#\n#########\n",
];
function mirror(input: string) {
  const [header, ...rows] = input.trimEnd().split("\n");
  return (
    header +
    "\n" +
    rows.map((row) => Array.from(row).reverse().join("")).join("\n") +
    "\n"
  );
}
export function gridGameExample(
  kind: GridGameConfig["objective"],
  protocol: GridGameConfig["protocol"] = "turns",
) {
  const maps = kind === "maze" ? MAZE : TREASURE;
  const draft: ProblemPackageEditorDraft = {
    sourceLabel: `grid-${kind}.zip`,
    checkerType: "heuristic",
    checkerLanguage: "javascript",
    checkerSourceCode: GRID_GAME_CHECKER_MARKER,
    compareMode: "exact",
    zipSizeBytes: 0,
    fileCount: 0,
    samples: [
      {
        id: "sample1",
        name: "sample1",
        input: maps[0],
        output: "RIGHT\nRIGHT\nRIGHT\nRIGHT\nRIGHT\n",
        description:
          "These are board data for preview. The bot receives six-field turn observations; the output shows one action per turn.",
      },
    ],
    warnings: [],
    groups: [
      {
        id: "provisional",
        name: "provisional",
        score: null,
        tests: [maps[0], maps[1], mirror(maps[0])].map((input, i) => ({
          id: `p${i}`,
          name: `case0${i + 1}`,
          input,
          output: "",
        })),
      },
      {
        id: "system",
        name: "system",
        score: null,
        tests: [mirror(maps[1]), maps[1], mirror(maps[0])].map((input, i) => ({
          id: `s${i}`,
          name: `case0${i + 1}`,
          input,
          output: "",
        })),
      },
    ],
    heuristic: {
      ...DEFAULT_HEURISTIC_CONFIG,
      seeds: {},
      visualizer: "board",
      board: structuredClone(DEFAULT_BOARD_CONFIG),
      game: { ...DEFAULT_GRID_GAME, objective: kind, protocol },
      finalGroups: ["system"],
    },
  };
  return {
    title: kind === "maze" ? "Maze Robot" : "Treasure Collector",
    slug: `grid-${kind}`,
    visibility: "unlisted" as const,
    explanationVisibility: "private" as const,
    difficulty: null,
    testCaseVisibility: "case_index_only" as const,
    tags: ["game", kind],
    timeLimitMs: 3000,
    memoryLimitMb: 256,
    statementMarkdown:
      kind === "maze"
        ? "# Maze Robot\n\nControl a robot and reach `G` without hitting `#`. Fewer moves give a larger score.\n\n| Symbol | Meaning |\n| --- | --- |\n| S | Robot start |\n| G | Exit |\n| # | Wall |\n| . | Floor |\n"
        : "# Treasure Collector\n\nCollect `o` treasures, then reach `G`. Every treasure gives 1000 additional points. Avoid walls `#`.\n",
    inputDescription:
      protocol === "turns"
        ? "Read `H W turn maxTurns x y`, then H grid rows for each observation. Coordinates start at the top left. A final line `END` means the program must exit. Flush every action."
        : "Read H W, then H grid rows. S is the initial robot position.",
    outputDescription:
      "Output UP, DOWN, LEFT, RIGHT, WAIT or STOP. Reaching G ends the game. A collision, missing the exit, or exceeding the turn limit is invalid.",
    constraintsMarkdown:
      "H, W <= 32; at most 500 turns. An isolated worker is required for server execution.",
    explanationMarkdown:
      "Use breadth-first search for a shortest path. For the small treasure examples, search over position and collected-item bitmask. Score = 100000 + collected * 1000 + maxTurns - moves (collected is ignored in the maze).",
    draft,
  };
}

// An independent breadth-first oracle for the small generated examples.
export function gridGameOracle(
  input: string,
  kind: GridGameConfig["objective"],
  maxTurns = 200,
) {
  const [, ...rows] = input.trimEnd().split("\n"),
    w = rows[0].length,
    items = new Map<number, number>();
  let start = 0;
  rows.forEach((row, y) =>
    Array.from(row).forEach((c, x) => {
      if (c === "S") start = y * w + x;
      if (c === "o") items.set(y * w + x, items.size);
    }),
  );
  const queue = [{ pos: start, mask: 0, distance: 0 }],
    seen = new Set([`${start}:0`]);
  let best: number | null = null;
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head],
      x = current.pos % w,
      y = Math.floor(current.pos / w);
    if (rows[y][x] === "G") {
      const count =
        kind === "treasure"
          ? current.mask.toString(2).replaceAll("0", "").length
          : 0;
      best = Math.max(
        best ?? 0,
        100000 + count * 1000 + maxTurns - current.distance,
      );
      continue;
    }
    if (current.distance >= maxTurns) continue;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (
        nx < 0 ||
        nx >= w ||
        ny < 0 ||
        ny >= rows.length ||
        rows[ny][nx] === "#"
      )
        continue;
      const pos = ny * w + nx,
        mask = current.mask | (items.has(pos) ? 1 << items.get(pos)! : 0),
        key = `${pos}:${mask}`;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push({ pos, mask, distance: current.distance + 1 });
      }
    }
  }
  return best === null ? null : String(best);
}

export function gridGamePythonSolution(
  kind: GridGameConfig["objective"],
  protocol: GridGameConfig["protocol"] = "turns",
) {
  const planner = `from collections import deque
def plan(board, sx, sy):
    h, w = len(board), len(board[0])
    items = {(x,y): i for i,(x,y) in enumerate(( (x,y) for y in range(h) for x in range(w) if board[y][x] == 'o' ))}
    q = deque([(sx,sy,0,[])])
    seen = {(sx,sy,0)}
    best_score, best = -10**18, []
    while q:
        x,y,mask,path = q.popleft()
        if board[y][x] == 'G':
            score = ${kind === "treasure" ? "mask.bit_count() * 1000" : "0"} - len(path)
            if score > best_score:
                best_score, best = score, path
            continue
        if len(path) >= 200: continue
        for action,dx,dy in [('RIGHT',1,0),('LEFT',-1,0),('DOWN',0,1),('UP',0,-1)]:
            nx,ny = x+dx,y+dy
            if not (0 <= nx < w and 0 <= ny < h) or board[ny][nx] == '#': continue
            nm = mask | (1 << items[(nx,ny)] if (nx,ny) in items else 0)
            if (nx,ny,nm) not in seen:
                seen.add((nx,ny,nm)); q.append((nx,ny,nm,path+[action]))
    return best
`;
  return protocol === "turns"
    ? planner +
        `actions = None
while True:
    header = input()
    if header == 'END': break
    h,w,turn,limit,x,y = map(int,header.split())
    board = [input() for _ in range(h)]
    if actions is None: actions = plan(board,x,y)
    print(actions.pop(0) if actions else 'STOP',flush=True)
`
    : planner +
        `h,w = map(int,input().split())
board = [input() for _ in range(h)]
x,y = next((x,y) for y in range(h) for x in range(w) if board[y][x] == 'S')
print(' '.join(plan(board,x,y)))
`;
}

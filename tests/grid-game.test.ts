import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BOARD_CONFIG,
  DEFAULT_GRID_GAME,
  BOARD_EXAMPLE_INPUT,
  BOARD_EXAMPLE_OUTPUT,
  GridGame,
  gridGameObservationText,
  parseBoardConfig,
  parseGridGameConfig,
  parseBoardInput,
  parseBoardReplay,
  simulateGridGame,
} from "../lib/board-visualization";
import {
  parseHeuristicConfig,
  DEFAULT_HEURISTIC_CONFIG,
  publicHeuristicSettings,
} from "../lib/heuristic-config";
import {
  gamePreviewPayload,
  gamePreviewPackage,
  readGamePreviewRequest,
} from "../lib/grid-game-preview";
import {
  gridGameExample,
  gridGameOracle,
  gridGamePythonSolution,
} from "../lib/grid-game-examples";
import { gridGameTemplates } from "../lib/grid-game-templates";
import { assertGameExecutionAllowed } from "../lib/grid-game-runtime";
import {
  buildProblemPackageZip,
  validateProblemPackage,
  inspectProblemPackageManifestFromZip,
} from "../lib/problem-package";
import {
  createLazyProblemPackageSourceFromBuffer,
  buildEditorDraftFromLazySource,
} from "../lib/problem-package-lazy";
import { inspectProblemPackageClient } from "../lib/problem-package-client-inspect";
import { buildProblemPackageZipBlob } from "../lib/problem-package-client-zip";
import { executePackageJudge } from "../lib/judge-runtime";
import { SUBMISSION_LANGUAGES } from "../lib/languages";

const config = {
  ...DEFAULT_HEURISTIC_CONFIG,
  visualizer: "board" as const,
  board: structuredClone(DEFAULT_BOARD_CONFIG),
  game: { ...DEFAULT_GRID_GAME },
};
test("board config and input are versioned, bounded and declarative", () => {
  assert.deepEqual(
    parseBoardConfig(DEFAULT_BOARD_CONFIG),
    DEFAULT_BOARD_CONFIG,
  );
  assert.deepEqual(parseGridGameConfig(DEFAULT_GRID_GAME), DEFAULT_GRID_GAME);
  assert.deepEqual(parseHeuristicConfig(config).game, config.game);
  for (const raw of [
    { ...config, board: undefined },
    { ...config, direction: "minimize" },
    { ...config, game: { ...config.game, maxTurns: 501 } },
  ])
    assert.throws(() => parseHeuristicConfig(raw));
  for (const raw of [
    { ...DEFAULT_BOARD_CONFIG, version: 2 },
    { ...DEFAULT_BOARD_CONFIG, playerSymbol: "." },
    { ...DEFAULT_BOARD_CONFIG, wallSymbols: "#." },
    {
      ...DEFAULT_BOARD_CONFIG,
      symbols: [
        ...DEFAULT_BOARD_CONFIG.symbols,
        DEFAULT_BOARD_CONFIG.symbols[0],
      ],
    },
    {
      ...DEFAULT_BOARD_CONFIG,
      symbols: [
        {
          ...DEFAULT_BOARD_CONFIG.symbols[0],
          color: "url(javascript:alert(1))",
        },
      ],
    },
  ])
    assert.throws(() => parseBoardConfig(raw));
  for (const input of [
    "33 1\n" + "#\n".repeat(33),
    "2 2\n###\n##",
    "8192 0\n",
    "x".repeat(8193),
  ])
    assert.throws(() => parseBoardInput(input));
  assert.equal(parseBoardInput("\uFEFF1 2\r\nSG\r\n")[0], "SG");
});
test("game steps produce deterministic delta replays and authoritative scores", () => {
  const result = simulateGridGame(
    BOARD_EXAMPLE_INPUT,
    BOARD_EXAMPLE_OUTPUT,
    DEFAULT_BOARD_CONFIG,
    { ...DEFAULT_GRID_GAME, objective: "treasure" },
  );
  assert.equal(result.score, "101195");
  assert.equal(result.success, true);
  assert.equal(result.frames.length, 6);
  assert.deepEqual(result.frames[3].cleared, [{ x: 4, y: 1 }]);
  assert.deepEqual(
    result,
    simulateGridGame(
      BOARD_EXAMPLE_INPUT,
      BOARD_EXAMPLE_OUTPUT,
      DEFAULT_BOARD_CONFIG,
      { ...DEFAULT_GRID_GAME, objective: "treasure" },
    ),
  );
  const game = new GridGame(
    BOARD_EXAMPLE_INPUT,
    DEFAULT_BOARD_CONFIG,
    DEFAULT_GRID_GAME,
  );
  assert.ok(gridGameObservationText(game).startsWith("5 8 0 200 1 1\n"));
  for (let i = 0; i < 3; i++) game.step("RIGHT");
  assert.ok(!game.observation().board.join("").includes("o"));
  game.step("RIGHT");
  game.step("RIGHT");
  assert.equal(gridGameObservationText(game), "END\n");
  for (const output of ["LEFT", "STOP", "constructor", "__proto__", ""]) {
    const replay = simulateGridGame(
      BOARD_EXAMPLE_INPUT,
      output,
      DEFAULT_BOARD_CONFIG,
      DEFAULT_GRID_GAME,
    );
    assert.equal(replay.success, false);
    assert.equal(replay.score, null);
  }
  assert.throws(
    () => new GridGame("1 2\nGG\n", DEFAULT_BOARD_CONFIG, DEFAULT_GRID_GAME),
  );
  const limited = simulateGridGame(
    BOARD_EXAMPLE_INPUT,
    "WAIT WAIT",
    DEFAULT_BOARD_CONFIG,
    { ...DEFAULT_GRID_GAME, maxTurns: 2 },
  );
  assert.equal(limited.message, "Turn limit reached");
});
test("custom board frames and paths reject unsafe styles, duplicate pieces and excess data", () => {
  const replay = parseBoardReplay(
    "2 2\n..\n..\n",
    JSON.stringify({
      frames: [
        {
          pieces: [{ id: "a", x: 0, y: 1, glyph: "K", color: "#ffffff" }],
          paths: [
            [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          ],
          cleared: [],
        },
      ],
    }),
    DEFAULT_BOARD_CONFIG,
  );
  assert.equal(replay.frames[0].pieces[0].glyph, "K");
  assert.equal(replay.frames[0].paths?.[0].length, 2);
  for (const frame of [
    { pieces: [{ id: "a", x: 9, y: 0 }] },
    { pieces: [{ id: "a", x: 0, y: 0, color: "red;position:fixed" }] },
    {
      pieces: [
        { id: "a", x: 0, y: 0 },
        { id: "a", x: 1, y: 1 },
      ],
    },
    { board: ["..."] },
    { paths: [[{ x: -1, y: 0 }]] },
  ])
    assert.throws(() =>
      parseBoardReplay(
        "2 2\n..\n..",
        JSON.stringify({ frames: [frame] }),
        DEFAULT_BOARD_CONFIG,
      ),
    );
  assert.throws(() =>
    parseBoardReplay("1 1\n.", "x".repeat(262145), DEFAULT_BOARD_CONFIG),
  );
  assert.throws(() =>
    parseBoardReplay(
      "1 1\n.",
      JSON.stringify({ frames: Array(502).fill({}) }),
      DEFAULT_BOARD_CONFIG,
    ),
  );
});
test("public preview snapshots contain only caller board and public settings", async () => {
  const payload = gamePreviewPayload(
    {
      ...config,
      seeds: { "secret/case": "private-seed" },
      finalGroups: ["secret"],
    },
    BOARD_EXAMPLE_INPUT,
  );
  assert.deepEqual(payload.config.seeds, {});
  assert.deepEqual(payload.config.finalGroups, []);
  assert.ok(!JSON.stringify(payload).includes("private-seed"));
  assert.deepEqual(
    publicHeuristicSettings(config)?.board,
    DEFAULT_BOARD_CONFIG,
  );
  const parsed = await readGamePreviewRequest(
    new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({
        language: "python",
        sourceCode: "print(1)",
        input: BOARD_EXAMPLE_INPUT,
      }),
    }),
  );
  assert.equal(parsed.language, "python");
  await assert.rejects(
    readGamePreviewRequest(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ language: "unknown", sourceCode: "x" }),
      }),
    ),
  );
  await assert.rejects(
    readGamePreviewRequest(
      new Request("http://localhost/api", {
        method: "POST",
        body: " ".repeat(131073),
      }),
    ),
    /128 KiB/,
  );
  for (const sourceCode of ["\0", "\ud800"])
    await assert.rejects(
      readGamePreviewRequest(
        new Request("http://localhost/api", {
          method: "POST",
          body: JSON.stringify({ language: "python", sourceCode }),
        }),
      ),
      /valid text/,
    );
});
test("game execution fails closed outside an isolated worker", () => {
  const previous = { ...process.env };
  try {
    process.env.JUDGE_SANDBOX = "basic";
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.OJP_GAME_UNSAFE_LOCAL_TEST = "1";
    assert.throws(assertGameExecutionAllowed, /isolated/);
    Object.assign(process.env, { NODE_ENV: "test" });
    assert.doesNotThrow(assertGameExecutionAllowed);
  } finally {
    for (const key of [
      "JUDGE_SANDBOX",
      "NODE_ENV",
      "OJP_GAME_UNSAFE_LOCAL_TEST",
    ])
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
  }
});
test("game ZIP survives server, browser, manifest, export and lazy editor round trips", async () => {
  for (const kind of ["maze", "treasure"] as const) {
    const example = gridGameExample(kind),
      zip = buildProblemPackageZip(example),
      eager = validateProblemPackage(kind + ".zip", zip);
    assert.deepEqual(eager.heuristic, example.draft.heuristic);
    assert.equal(eager.validation.totalTestPairs, 6);
    assert.deepEqual(
      inspectProblemPackageManifestFromZip("case.zip", zip).heuristic,
      eager.heuristic,
    );
    const client = await inspectProblemPackageClient(
      Object.assign(Buffer.from(zip), {
        name: "case.zip",
        size: zip.length,
      }) as unknown as File,
    );
    assert.deepEqual(client.draft.heuristic, eager.heuristic);
    const blob = await buildProblemPackageZipBlob({
      ...example,
      draft: client.draft,
    });
    assert.deepEqual(
      validateProblemPackage(
        "client.zip",
        Buffer.from(await blob.arrayBuffer()),
      ).heuristic,
      eager.heuristic,
    );
    const lazy = await createLazyProblemPackageSourceFromBuffer(
      "lazy.zip",
      zip,
    );
    try {
      const draft = await buildEditorDraftFromLazySource(lazy);
      assert.deepEqual(draft.heuristic, eager.heuristic);
    } finally {
      await lazy.cleanup();
    }
  }
});

async function localExecution<T>(run: () => Promise<T>) {
  const old = {
    node: process.env.NODE_ENV,
    allow: process.env.OJP_GAME_UNSAFE_LOCAL_TEST,
  };
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.OJP_GAME_UNSAFE_LOCAL_TEST = "1";
  try {
    return await run();
  } finally {
    if (old.node === undefined)
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else Object.assign(process.env, { NODE_ENV: old.node });
    if (old.allow === undefined) delete process.env.OJP_GAME_UNSAFE_LOCAL_TEST;
    else process.env.OJP_GAME_UNSAFE_LOCAL_TEST = old.allow;
  }
}
test("turn-based execution, missing flush, EOF, invalid actions and private replay boundary", async () =>
  localExecution(async () => {
    const data = gamePreviewPackage(
      gamePreviewPayload(config, "3 4\n####\n#SG#\n####\n"),
    );
    for (const [source, status] of [
      [gridGameTemplates("turns").javascript, "accepted"],
      ["process.exit(0)", "wrong_answer"],
      ["console.log('STOP')", "wrong_answer"],
      ["console.log('LEFT')", "wrong_answer"],
      ["console.log('BAD')", "wrong_answer"],
      ["setInterval(()=>{},1000)", "time_limit_exceeded"],
      ["console.log('A'.repeat(200))", "runtime_error"],
    ] as const) {
      const quick = {
        ...data,
        heuristic: {
          ...data.heuristic!,
          game: { ...data.heuristic!.game!, firstTurnTimeLimitMs: 300 },
        },
      };
      const result = await executePackageJudge({
        packageData: quick,
        sourceCode: source,
        language: "javascript",
        timeLimitMs: 1500,
        memoryLimitMb: 256,
        nextTestResultId: () => "test",
        includeBoardReplay: true,
      });
      assert.equal(result.status, status, JSON.stringify(result));
      assert.ok(result.testResults[0].boardReplay);
      if (status === "accepted") assert.equal(result.heuristicScore, "100199");
    }
    const secret = await executePackageJudge({
      packageData: data,
      sourceCode: gridGameTemplates("turns").javascript,
      language: "javascript",
      timeLimitMs: 3000,
      memoryLimitMb: 256,
      nextTestResultId: () => "private",
    });
    assert.ok(!JSON.stringify(secret).includes("boardReplay"));
    const overridden = await executePackageJudge({
      packageData: data,
      heuristicOverride: {
        ...data.heuristic!,
        game: { ...data.heuristic!.game!, maxTurns: 250 },
      },
      sourceCode: gridGameTemplates("turns").javascript,
      language: "javascript",
      timeLimitMs: 3000,
      memoryLimitMb: 256,
      nextTestResultId: () => "fixed-settings",
    });
    assert.equal(overridden.heuristicScore, "100249");
    const diagnostic = await executePackageJudge({
      packageData: data,
      sourceCode:
        "process.stderr.write('\\0probe');\n" +
        gridGameTemplates("turns").javascript,
      language: "javascript",
      timeLimitMs: 3000,
      memoryLimitMb: 256,
      nextTestResultId: () => "safe-diagnostic",
      includeBoardReplay: true,
    });
    assert.equal(diagnostic.status, "accepted");
    assert.ok(!diagnostic.testResults[0].scorerDiagnostic?.includes("\0"));
    const rejected = await executePackageJudge({
      packageData: data,
      sourceCode: "console.log('LEFT');while(true){}",
      language: "javascript",
      timeLimitMs: 100,
      memoryLimitMb: 256,
      nextTestResultId: () => "wa-before-kill",
    });
    assert.equal(
      rejected.status,
      "wrong_answer",
      "A known invalid move must not become TLE during cleanup",
    );
  }));

for (const language of SUBMISSION_LANGUAGES)
  test(
    `grid game turn starter: ${language}`,
    {
      skip:
        process.platform === "win32" &&
        !["javascript", "brainfuck"].includes(language),
    },
    async () =>
      localExecution(async () => {
        const initial = "3 4\n####\n#SG#\n####\n",
          data = gamePreviewPackage(gamePreviewPayload(config, initial));
        let source = gridGameTemplates("turns")[language];
        if (language === "brainfuck") {
          const observation = gridGameObservationText(
            new GridGame(initial, DEFAULT_BOARD_CONFIG, DEFAULT_GRID_GAME),
          );
          let cell = 10;
          source =
            ",".repeat(observation.length) +
            Array.from("RIGHT\n")
              .map((c) => {
                const n = c.charCodeAt(0),
                  delta = n - cell;
                cell = n;
                return (delta >= 0 ? "+" : "-").repeat(Math.abs(delta)) + ".";
              })
              .join("") +
            ",".repeat(4);
        }
        const result = await executePackageJudge({
          packageData: data,
          sourceCode: source,
          language,
          timeLimitMs: 3000,
          memoryLimitMb: 256,
          nextTestResultId: () => language,
        });
        assert.equal(result.status, "accepted", JSON.stringify(result));
        assert.equal(result.heuristicScore, "100199");
      }),
  );

for (const kind of ["maze", "treasure"] as const)
  for (const protocol of ["moves", "turns"] as const)
    test(
      `independent oracle and real Python ${kind}/${protocol}`,
      { skip: process.platform === "win32" },
      async () =>
        localExecution(async () => {
          const example = gridGameExample(kind, protocol),
            data = validateProblemPackage(
              "game.zip",
              buildProblemPackageZip(example),
            );
          for (const phase of ["provisional", "system"] as const) {
            const result = await executePackageJudge({
              packageData: data,
              phase,
              sourceCode: gridGamePythonSolution(kind, protocol),
              language: "python",
              timeLimitMs: 3000,
              memoryLimitMb: 256,
              nextTestResultId: () => "oracle",
            });
            assert.equal(result.status, "accepted", JSON.stringify(result));
            const group = example.draft.groups[phase === "system" ? 1 : 0];
            assert.deepEqual(
              result.testResults.map((r) => r.rawScore),
              group.tests.map((c) => gridGameOracle(c.input, kind)),
            );
            assert.equal(result.testResults.length, 3);
          }
        }),
    );

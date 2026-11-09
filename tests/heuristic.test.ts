import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  parseHeuristicConfig,
  DEFAULT_HEURISTIC_CONFIG,
} from "../lib/heuristic-config";
import {
  absoluteScore,
  parseScorerResult,
  rankHeuristicAttempts,
  scoreDecimal,
  scoreString,
} from "../lib/heuristic-score";
import { createHeuristicExample, oracleScore } from "../lib/heuristic-examples";
import {
  validateProblemPackage,
  buildEditorDraftManifestFromZip,
  inspectProblemPackageManifestFromZip,
} from "../lib/problem-package";
import { inspectProblemPackageClient } from "../lib/problem-package-client-inspect";
import { buildProblemPackageZipBlob } from "../lib/problem-package-client-zip";
import {
  createLazyProblemPackageSourceFromBuffer,
  buildEditorDraftFromLazySource,
} from "../lib/problem-package-lazy";
import { executePackageJudge } from "../lib/judge-runtime";
import { SCORER_SOURCE_TEMPLATES } from "../lib/scorer-source-templates";
import { parseVisualization } from "../lib/heuristic-visualization";
import type { Language } from "../lib/types";

const config = { ...DEFAULT_HEURISTIC_CONFIG };
test("invalid scorer output is IE without leaking stdout; valid zero remains AC", async () => {
  const example = createHeuristicExample("knapsack", {
    provisional: 1,
    system: 1,
  });
  for (const [source, verdict, score] of [
    [
      "console.log(JSON.stringify({version:1,valid:true,score:'0'}))",
      "accepted",
      "0",
    ],
    ["console.log('private-input-marker')", "internal_error", null],
    ["process.exit(1)", "internal_error", null],
    [
      "console.log(JSON.stringify({version:1,valid:false}))",
      "wrong_answer",
      "0",
    ],
  ] as const) {
    const data = validateProblemPackage("case.zip", example.zip);
    data.checkerLanguage = "javascript";
    data.checkerSourceCode = source;
    const result = await executePackageJudge({
      packageData: data,
      sourceCode: "console.log(0)",
      language: "javascript",
      timeLimitMs: 3000,
      memoryLimitMb: 256,
      nextTestResultId: () => "case",
    });
    assert.equal(result.status, verdict);
    assert.equal(result.heuristicScore, score);
    assert.ok(
      !result.testResults.some((c) =>
        c.message.includes("private-input-marker"),
      ),
    );
  }
});
const numericPrograms: Record<Language, string> = {
  javascript: "console.log(7)",
  python: "print(7)",
  cpp: "#include <iostream>\nint main(){std::cout<<7;}",
  java: "public class Main {public static void main(String[] args){System.out.println(7);}}",
  brainfuck: "+++++++[>++++++++<-]>-.",
  c: '#include <stdio.h>\nint main(void){printf("7");return 0;}',
  rust: 'fn main(){println!("7");}',
  go: 'package main\nimport "fmt"\nfunc main(){fmt.Println(7)}',
  csharp:
    "using System;class MainClass{static void Main(){Console.WriteLine(7);}}",
  kotlin: "fun main(){println(7)}",
  ruby: "puts 7",
  pypy: "print(7)",
};
for (const [language, sourceCode] of Object.entries(numericPrograms))
  test(
    `numeric submission ${language}`,
    {
      skip: process.platform !== "linux" && language !== "javascript",
      timeout: 60000,
    },
    async () => {
      const example = createHeuristicExample("knapsack", {
        provisional: 1,
        system: 1,
      });
      const data = validateProblemPackage("numeric.zip", example.zip);
      data.checkerLanguage = "javascript";
      data.checkerSourceCode = SCORER_SOURCE_TEMPLATES.javascript;
      data.groups[0].tests = [{ name: "one", input: "10\n", output: "" }];
      const result = await executePackageJudge({
        packageData: data,
        sourceCode,
        language: language as Language,
        timeLimitMs: 5000,
        memoryLimitMb: 512,
        nextTestResultId: () => "one",
      });
      assert.equal(result.status, "accepted", JSON.stringify(result));
      assert.equal(result.heuristicScore, "7");
    },
  );
const cases = (...scores: Array<string | null>) =>
  scores.map((s, i) => ({
    key: String(i),
    rawScore: s,
    verdict: s === null ? "wrong_answer" : "accepted",
  }));
test("heuristic decimal protocol rejects unsafe and malformed values", () => {
  for (const value of [
    "NaN",
    "Infinity",
    "-1",
    "1e20",
    "0.0000000000001",
    "1.1.1",
    4,
    "",
    "1000000000000000000000000",
  ])
    assert.throws(() => scoreDecimal(value));
  assert.equal(
    scoreString(scoreDecimal("1000.000000000001")),
    "1000.000000000001",
  );
  assert.equal(
    parseScorerResult('{"version":1,"valid":true,"score":"0"}').score,
    "0",
  );
  assert.equal(parseScorerResult('{"version":1,"valid":false}').score, null);
  for (const value of [
    "[]",
    '{"valid":true}',
    '{"version":1,"valid":true,"score":1}',
    '{"version":1,"valid":true,"score":"-1"}',
    "{}\n{}",
    " ".repeat(16385),
  ])
    assert.throws(() => parseScorerResult(value));
  assert.throws(() => parseHeuristicConfig({ direction: "minimum" }));
});
test("absolute sum/mean preserve zero and invalid minimization is never best", () => {
  assert.equal(absoluteScore(config, cases("0", "0")), "0");
  assert.equal(
    absoluteScore({ ...config, aggregate: "mean" }, cases("1", "2", "2")),
    "1.666666666667",
  );
  assert.equal(absoluteScore(config, cases("2", null)), "2");
  assert.equal(
    absoluteScore(
      { ...config, failurePolicy: "submission_zero" },
      cases("2", null),
    ),
    null,
  );
  assert.equal(
    absoluteScore({ ...config, direction: "minimize" }, cases("2", null)),
    null,
  );
});
test("relative ranking uses per-case baselines, handles zero and never combines submissions", () => {
  const attempts = [
    {
      id: "a1",
      userId: "a",
      submittedAt: "2026-01-01",
      cases: cases("10", "1"),
    },
    {
      id: "a2",
      userId: "a",
      submittedAt: "2026-01-02",
      cases: cases("1", "10"),
    },
    { id: "b", userId: "b", submittedAt: "2026-01-03", cases: cases("9", "9") },
  ];
  const ranked = rankHeuristicAttempts(
    { ...config, evaluation: "relative" },
    attempts,
    "best",
  );
  assert.equal(ranked[0].userId, "b");
  assert.equal(ranked[0].score, "1800000000");
  assert.equal(ranked[1].score, "1100000000");
  assert.equal(
    rankHeuristicAttempts(config, attempts, "last").find(
      (r) => r.userId === "a",
    )?.submissionId,
    "a2",
  );
  const zero = [
    { id: "a", userId: "a", submittedAt: "1", cases: cases("0") },
    { id: "b", userId: "b", submittedAt: "2", cases: cases("5") },
  ];
  const minimum = rankHeuristicAttempts(
    { ...config, direction: "minimize", evaluation: "relative" },
    zero,
    "best",
  );
  assert.deepEqual(
    minimum.map((x) => x.score),
    ["1000000000", "0"],
  );
  assert.equal(
    rankHeuristicAttempts(
      { ...config, evaluation: "relative" },
      zero.map((x) => ({ ...x, cases: cases("0") })),
      "best",
    )[1].rank,
    1,
  );
});
test("heuristic examples round trip eager, manifest, lazy and browser ZIP paths", async () => {
  for (const kind of ["knapsack", "route"] as const) {
    const example = createHeuristicExample(kind);
    const data = validateProblemPackage(kind + ".zip", example.zip);
    assert.equal(data.scoringType, "heuristic");
    assert.equal(data.groups.length, 2);
    assert.deepEqual(data.heuristic, example.draft.heuristic);
    assert.equal(data.validation.totalTestPairs, 40);
    const manifest = inspectProblemPackageManifestFromZip(
      kind + ".zip",
      example.zip,
    );
    assert.deepEqual(manifest.heuristic, data.heuristic);
    const draft = buildEditorDraftManifestFromZip(kind + ".zip", example.zip);
    assert.deepEqual(draft.heuristic, data.heuristic);
    const client = await inspectProblemPackageClient(
      Object.assign(Buffer.from(example.zip), {
        name: kind + ".zip",
        size: example.zip.length,
      }) as unknown as File,
    );
    assert.deepEqual(client.draft.heuristic, data.heuristic);
    const blob = await buildProblemPackageZipBlob(example.settings);
    assert.deepEqual(
      validateProblemPackage(
        kind + ".zip",
        Buffer.from(await blob.arrayBuffer()),
      ).heuristic,
      data.heuristic,
    );
    const lazy = await createLazyProblemPackageSourceFromBuffer(
      kind + ".zip",
      example.zip,
    );
    try {
      assert.equal(lazy.groups[0].caseNames.length, 10);
      assert.equal((await lazy.readTestCase("system", "case01")).output, "");
      assert.deepEqual(lazy.manifest.heuristic, data.heuristic);
      const lazyEditor = buildEditorDraftFromLazySource(lazy);
      assert.deepEqual(lazyEditor.heuristic, data.heuristic);
      assert.equal(lazyEditor.isPartial, true);
      assert.ok(
        lazyEditor.groups.every((group) =>
          group.tests.every(
            (c) => c.isLoaded === false && c.input === "" && c.output === "",
          ),
        ),
      );
    } finally {
      await lazy.cleanup();
    }
  }
});
test("built-in visualizers validate outputs without loading hidden test data", () => {
  assert.equal(
    parseVisualization("knapsack", "2 5\n2 10\n4 20", "1 0").score,
    10,
  );
  assert.throws(() => parseVisualization("knapsack", "2 5\n2 10\n4 20", "1 1"));
  assert.equal(
    parseVisualization("route", "3\n0 0\n1 0\n0 1", "0 1 2").score,
    4,
  );
  assert.throws(() => parseVisualization("route", "3\n0 0\n1 0\n0 1", "0 1 1"));
});
for (const language of ["javascript", "python", "cpp", "java"] as const)
  test(
    `numeric scorer template ${language}`,
    { skip: process.platform !== "linux" && language !== "javascript" },
    async () => {
      const example = createHeuristicExample("knapsack", {
        provisional: 1,
        system: 1,
      });
      const data = validateProblemPackage("example.zip", example.zip);
      data.checkerLanguage = language;
      data.checkerSourceCode = SCORER_SOURCE_TEMPLATES[language];
      data.groups[0].tests = [{ name: "one", input: "10\n", output: "" }];
      const result = await executePackageJudge({
        packageData: data,
        language: "javascript",
        sourceCode: "console.log('7')",
        timeLimitMs: 3000,
        memoryLimitMb: 256,
        nextTestResultId: () => "one",
      });
      assert.equal(result.status, "accepted", JSON.stringify(result));
      assert.equal(result.heuristicScore, "7");
    },
  );
for (const kind of ["knapsack", "route"] as const)
  test(
    `real ${kind} solutions, system split and independent optimum`,
    { skip: process.platform !== "linux", timeout: 240000 },
    async () => {
      const example = createHeuristicExample(kind);
      const data = validateProblemPackage(kind + ".zip", example.zip);
      const run = async (
        sourceCode: string,
        phase: "provisional" | "system" = "provisional",
      ) =>
        executePackageJudge({
          packageData: data,
          language: "python",
          sourceCode,
          phase,
          timeLimitMs: 3000,
          memoryLimitMb: 256,
          nextTestResultId: () => String(Math.random()),
        });
      const baseline = await run(example.solutions.baseline),
        optimal = await run(example.solutions.optimal),
        invalid = await run(example.solutions.invalid);
      assert.equal(baseline.status, "accepted");
      assert.equal(optimal.status, "accepted");
      assert.equal(invalid.status, "wrong_answer");
      assert.equal(optimal.testResults.length, 10);
      assert.ok(
        optimal.testResults.every((r) => r.groupName === "provisional"),
      );
      for (const result of optimal.testResults) {
        const input = data.groups[0].tests.find(
          (c) => c.name === result.testCaseName,
        )!.input;
        assert.equal(result.rawScore, String(oracleScore(kind, input)));
      }
      assert.ok(
        new Prisma.Decimal(optimal.heuristicScore!).cmp(
          new Prisma.Decimal(baseline.heuristicScore!),
        ) *
          (kind === "knapsack" ? 1 : -1) >
          0,
      );
      const system = await run(example.solutions.optimal, "system");
      assert.equal(system.testResults.length, 30);
      for (const result of system.testResults)
        assert.equal(
          result.rawScore,
          String(
            oracleScore(
              kind,
              data.groups[1].tests.find((c) => c.name === result.testCaseName)!
                .input,
            ),
          ),
        );
    },
  );

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import AdmZip from "adm-zip";
import { runBrainfuck, BRAINFUCK_HELLO_WORLD } from "../lib/brainfuck.js";
import { brainfuckNodeRunner } from "../lib/brainfuck-node";
import { executePackageJudge } from "../lib/judge-runtime";
import { removeJudgeDirectory, runJudgeCommand } from "../lib/judge-process";
import { validateProblemPackage } from "../lib/problem-package";
import { parseLanguage } from "../lib/api-helpers";
import { languageLabel } from "../lib/presentation";
import { SOURCE_CODE_TEMPLATES } from "../lib/source-code-templates";
import {
  CHECKER_LANGUAGES,
  isSubmissionLanguage,
  SUBMISSION_LANGUAGES,
} from "../lib/languages";
import { CHECKER_SOURCE_TEMPLATES } from "../lib/checker-source-templates";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { brainfuckLanguage } from "../lib/brainfuck-editor";

function execute(source: string, input = new Uint8Array()) {
  let position = 0;
  const output: number[] = [];
  runBrainfuck(
    source,
    () => input[position++] ?? 0,
    (value) => output.push(value),
  );
  return Uint8Array.from(output);
}

test("the editor parses Brainfuck commands and comments with distinct syntax tokens", () => {
  const state = EditorState.create({
    doc: "+[>,.<-] comment",
    extensions: [brainfuckLanguage],
  });
  const nodes: string[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      nodes.push(node.name);
    },
  });
  for (const token of [
    "arithmeticOperator",
    "bracket",
    "operator",
    "keyword",
    "comment",
  ]) {
    assert.ok(nodes.includes(token), `${token}: ${nodes.join(",")}`);
  }
});

test("Brainfuck Hello World template runs with nested loops and comments", () => {
  assert.equal(
    new TextDecoder().decode(execute(BRAINFUCK_HELLO_WORLD)),
    "Hello World!\n",
  );
  assert.equal(
    new TextDecoder().decode(
      execute("ignored letters\n" + BRAINFUCK_HELLO_WORLD),
    ),
    "Hello World!\n",
  );
  assert.equal(execute("[+[+]-].")[0], 0);
  assert.equal(execute("++[>++[>++<-]<-]>>.")[0], 8);
});

test("cells wrap at 8 bits, comma reads bytes and EOF assigns zero", () => {
  assert.deepEqual([...execute("-.+.")], [255, 0]);
  assert.deepEqual([...execute("+".repeat(256) + ".")], [0]);
  assert.deepEqual([...execute(",.,.", Uint8Array.from([255]))], [255, 0]);
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual(execute(",.".repeat(bytes.length), bytes), bytes);
});

test("UTF-8 bytes are echoed without reinterpretation", () => {
  const input = new TextEncoder().encode("こんにちは、OJP!\n");
  assert.deepEqual(execute(",[.,]", input), input);
});

test("brackets are validated before execution, including in skipped loops", () => {
  for (const program of ["[", "]", "[]]", "[[]", "]["]) {
    assert.throws(() => execute(program), SyntaxError);
  }
  assert.doesNotThrow(() =>
    runBrainfuck(
      "+[]",
      () => 0,
      () => {},
      true,
    ),
  );
});

test("the pointer must remain inside the 30000-cell zero-initialized tape", () => {
  assert.equal(execute(">".repeat(29999) + ".")[0], 0);
  assert.throws(() => execute("<"), /outside/);
  assert.throws(() => execute(">".repeat(30000)), /outside/);
});

test("all submission languages have templates and Brainfuck is not a checker language", () => {
  assert.equal(isSubmissionLanguage("brainfuck"), true);
  assert.equal(parseLanguage("brainfuck"), "brainfuck");
  assert.equal(languageLabel("brainfuck"), "Brainfuck");
  assert.equal(
    SUBMISSION_LANGUAGES.every(
      (value) => typeof SOURCE_CODE_TEMPLATES[value] === "string",
    ),
    true,
  );
  assert.equal(CHECKER_LANGUAGES.includes("brainfuck" as never), false);
  assert.equal(Object.hasOwn(CHECKER_SOURCE_TEMPLATES, "brainfuck"), false);
});

test("the generated Node runner streams raw bytes across input/output buffer boundaries", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ojp-brainfuck-"));
  try {
    await writeFile(path.join(cwd, "runtime.cjs"), brainfuckNodeRunner());
    const input = Buffer.from(Array.from({ length: 70000 }, (_, i) => i % 256));
    await writeFile(path.join(cwd, "Main.bf"), ",.".repeat(input.length));
    const result = spawnSync(process.execPath, ["runtime.cjs", "Main.bf"], {
      cwd,
      input,
      timeout: 10000,
      maxBuffer: 2 * input.length,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr?.toString());
    assert.deepEqual(result.stdout, input);
    await writeFile(path.join(cwd, "Main.bf"), "+[]");
    assert.equal(
      spawnSync(process.execPath, ["runtime.cjs", "Main.bf", "--check"], {
        cwd,
        timeout: 5000,
        windowsHide: true,
      }).status,
      0,
    );
  } finally {
    await removeJudgeDirectory(cwd);
  }
});

function echoPackage(specialJudge = false) {
  const zip = new AdmZip();
  zip.addFile("statement.md", Buffer.from("Echo input.\n"));
  zip.addFile(
    "config.json",
    Buffer.from(
      JSON.stringify({
        timeLimitMs: 2000,
        memoryLimitMb: 256,
        groups: ["echo"],
        compareMode: "exact",
        ...(specialJudge
          ? { checkerType: "special_judge", checkerLanguage: "javascript" }
          : {}),
      }),
    ),
  );
  if (specialJudge)
    zip.addFile(
      "checker/Main.js",
      Buffer.from(
        "const fs = require('node:fs'); process.exit(fs.readFileSync(process.argv[3]).equals(fs.readFileSync(process.argv[4])) ? 0 : 1);",
      ),
    );
  for (const folder of ["samples", "tests/echo"]) {
    for (const [index, value] of ["Hello\n", "こんにちは\n"].entries()) {
      zip.addFile(`${folder}/${index + 1}.in`, Buffer.from(value));
      zip.addFile(`${folder}/${index + 1}.out`, Buffer.from(value));
    }
  }
  return validateProblemPackage("echo.zip", zip.toBuffer());
}

test("Brainfuck submissions can be judged by an existing special judge", async () => {
  let id = 0;
  const result = await executePackageJudge({
    language: "brainfuck",
    sourceCode: ",[.,]",
    timeLimitMs: 3000,
    memoryLimitMb: 256,
    packageData: echoPackage(true),
    nextTestResultId: () => `special-bf-${++id}`,
  });
  assert.equal(result.status, "accepted", JSON.stringify(result.testResults));
});

for (const [source, status] of [
  [",[.,]", "accepted"],
  ["+", "wrong_answer"],
  ["][", "compilation_error"],
  ["<", "runtime_error"],
  ["+[]", "time_limit_exceeded"],
] as const) {
  test(`real judge returns ${status} for Brainfuck`, async () => {
    let id = 0;
    const result = await executePackageJudge({
      language: "brainfuck",
      sourceCode: source,
      timeLimitMs: status === "time_limit_exceeded" ? 300 : 3000,
      memoryLimitMb: 256,
      packageData: echoPackage(),
      nextTestResultId: () => `bf-${++id}`,
    });
    assert.equal(result.status, status, JSON.stringify(result.testResults));
    assert.equal(result.score, status === "accepted" ? 100 : 0);
    if (status === "accepted") assert.equal(result.testResults.length, 2);
  });
}

test("Brainfuck output is stopped by the existing judge output limiter", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ojp-brainfuck-output-"));
  try {
    await writeFile(path.join(cwd, "runtime.cjs"), brainfuckNodeRunner());
    await writeFile(path.join(cwd, "Main.bf"), "+[.]");
    const result = await runJudgeCommand(
      process.execPath,
      ["runtime.cjs", "Main.bf"],
      {
        cwd,
        stdin: "",
        timeoutMs: 3000,
        captureMemory: false,
        outputLimitBytes: 1024,
      },
    );
    assert.equal(result.outputLimitExceeded, true);
    assert.equal(result.timedOut, false);
  } finally {
    await removeJudgeDirectory(cwd);
  }
});

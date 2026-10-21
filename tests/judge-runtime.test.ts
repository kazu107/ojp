import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import { validateProblemPackage } from "../lib/problem-package";
import { executePackageJudge } from "../lib/judge-runtime";
import type { Language } from "../lib/types";

function packageData(checkerSourceCode?: string) {
  const zip = new AdmZip();
  zip.addFile("statement.md", Buffer.from("# Sum\n\nPrint the sum.\n"));
  zip.addFile("config.json", Buffer.from(JSON.stringify({
    timeLimitMs: 3000, memoryLimitMb: 256, groups: ["group1"], compareMode: "ignore_trailing_spaces",
    ...(checkerSourceCode ? { checkerType: "special_judge", checkerLanguage: "javascript" } : {}),
  })));
  zip.addFile("samples/sample1.in", Buffer.from("2 3\n"));
  zip.addFile("samples/sample1.out", Buffer.from("5\n"));
  zip.addFile("tests/group1/case01.in", Buffer.from("2 3\n"));
  zip.addFile("tests/group1/case01.out", Buffer.from("5\n"));
  zip.addFile("tests/group1/case02.in", Buffer.from("-1 10\n"));
  zip.addFile("tests/group1/case02.out", Buffer.from("9\n"));
  if (checkerSourceCode) zip.addFile("checker/Main.js", Buffer.from(checkerSourceCode));
  return validateProblemPackage("sum.zip", zip.toBuffer());
}

const programs: Record<Language, string> = {
  javascript: "console.log(require('node:fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number).reduce((a, b) => a + b, 0))",
  python: "import sys\nprint(sum(map(int, sys.stdin.read().split())))\n",
  cpp: "#include <iostream>\nint main() { long long a, b; std::cin >> a >> b; std::cout << a + b << '\\n'; }\n",
  java: "import java.util.*; public class Main { public static void main(String[] args) { Scanner s = new Scanner(System.in); System.out.println(s.nextLong() + s.nextLong()); } }",
};

for (const language of ["javascript", "cpp", "python", "java"] as const) {
  test(`normal ${language} submissions retain AC and group scoring`, {
    skip: process.platform !== "linux" && language !== "javascript",
  }, async () => {
    let index = 0;
    const result = await executePackageJudge({
      language, sourceCode: programs[language], timeLimitMs: 3000, memoryLimitMb: 256,
      packageData: packageData(), nextTestResultId: () => `case-${++index}`,
    });
    assert.equal(result.status, "accepted", JSON.stringify(result.testResults));
    assert.equal(result.score, 100);
    assert.equal(result.testResults.length, 2);
    assert.equal(result.totalTimeMs, Math.max(...result.testResults.map((entry) => entry.timeMs)));
  });
}

test("special judge receives all three files with the protected runner", async () => {
  const checker = `
    const fs = require('node:fs');
    if (!fs.readFileSync(process.argv[2], 'utf8').trim()) process.exit(2);
    process.exit(fs.readFileSync(process.argv[3], 'utf8').trim() === fs.readFileSync(process.argv[4], 'utf8').trim() ? 0 : 1);
  `;
  let index = 0;
  const result = await executePackageJudge({
    language: "javascript", sourceCode: programs.javascript, timeLimitMs: 3000, memoryLimitMb: 256,
    packageData: packageData(checker), nextTestResultId: () => `case-${++index}`,
  });
  assert.equal(result.status, "accepted", JSON.stringify(result.testResults));
  assert.equal(result.score, 100);
});

test("wrong answers remain WA after streaming comparison is closed early", async () => {
  let index = 0;
  const result = await executePackageJudge({
    language: "javascript", sourceCode: "console.log(0)", timeLimitMs: 3000, memoryLimitMb: 256,
    packageData: packageData(), nextTestResultId: () => `case-${++index}`,
  });
  assert.equal(result.status, "wrong_answer");
  assert.equal(result.score, 0);
});

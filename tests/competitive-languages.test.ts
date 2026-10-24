import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import { executePackageJudge } from "../lib/judge-runtime";
import { validateProblemPackage } from "../lib/problem-package";
import { SOURCE_CODE_TEMPLATES } from "../lib/source-code-templates";
import { isSubmissionLanguage } from "../lib/languages";
import { languageLabel } from "../lib/presentation";
import {
  NEW_LANGUAGES,
  ECHO_PROGRAMS,
  BAD_SYNTAX_PROGRAMS,
  RUNTIME_ERROR_PROGRAMS,
  INFINITE_PROGRAMS,
} from "./fixtures/competitive-programs";

function echoPackage() {
  const zip = new AdmZip();
  zip.addFile("statement.md", Buffer.from("# Echo\n\nCopy all input bytes."));
  zip.addFile(
    "config.json",
    Buffer.from(
      JSON.stringify({
        timeLimitMs: 3000,
        memoryLimitMb: 256,
        groups: ["echo"],
        compareMode: "exact",
      }),
    ),
  );
  for (const [index, text] of ["Hello\n", "日本語と空白 0123"].entries()) {
    for (const dir of ["samples", "tests/echo"])
      for (const suffix of ["in", "out"])
        zip.addFile(`${dir}/${index + 1}.${suffix}`, Buffer.from(text));
  }
  return validateProblemPackage("echo.zip", zip.toBuffer());
}

test("all additional runtimes are selectable, labeled and have starter templates", () => {
  for (const language of NEW_LANGUAGES) {
    assert.equal(isSubmissionLanguage(language), true);
    assert.ok(languageLabel(language).length > 0);
    assert.ok(SOURCE_CODE_TEMPLATES[language].length > 0);
  }
});

for (const language of NEW_LANGUAGES) {
  for (const [kind, expected] of [
    ["echo", "accepted"],
    ["template", "wrong_answer"],
    ["syntax", "compilation_error"],
    ["wrong", "wrong_answer"],
    ["runtime", "runtime_error"],
    ["loop", "time_limit_exceeded"],
  ] as const) {
    test(
      `${language}: ${kind} produces ${expected}`,
      { skip: process.platform !== "linux", timeout: 90000 },
      async () => {
        const source =
          kind === "template"
            ? SOURCE_CODE_TEMPLATES[language]
            : kind === "syntax"
              ? BAD_SYNTAX_PROGRAMS[language]
              : kind === "runtime"
                ? RUNTIME_ERROR_PROGRAMS[language]
                : kind === "loop"
                  ? INFINITE_PROGRAMS[language]
                  : ECHO_PROGRAMS[language];
        const data = echoPackage();
        if (kind === "wrong")
          for (const group of data.groups)
            for (const entry of group.tests)
              entry.output = "different output\n";
        let id = 0;
        const result = await executePackageJudge({
          language,
          sourceCode: source,
          timeLimitMs: kind === "loop" ? 500 : 3000,
          memoryLimitMb: 256,
          packageData: data,
          nextTestResultId: () => `new-${++id}`,
        });
        assert.equal(
          result.status,
          expected,
          JSON.stringify(result.testResults),
        );
        assert.equal(result.score, expected === "accepted" ? 100 : 0);
      },
    );
  }
}

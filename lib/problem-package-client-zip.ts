import JSZip from "jszip";
import {
  ExplanationVisibility,
  TestCaseVisibility,
  Visibility,
} from "@/lib/types";
import { ProblemPackageEditorDraft } from "@/lib/problem-package-types";

interface ProblemPackageClientZipInput {
  title: string;
  slug: string;
  visibility: Visibility;
  explanationVisibility: ExplanationVisibility;
  difficulty: number | null;
  testCaseVisibility: TestCaseVisibility;
  statementMarkdown: string;
  inputDescription: string;
  outputDescription: string;
  constraintsMarkdown: string;
  explanationMarkdown: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  draft: ProblemPackageEditorDraft;
}

function checkerSourceFileName(language: ProblemPackageEditorDraft["checkerLanguage"]): string {
  switch (language) {
    case "cpp":
      return "checker/Main.cpp";
    case "python":
      return "checker/Main.py";
    case "java":
      return "checker/Main.java";
    case "javascript":
      return "checker/Main.js";
    default:
      return "checker/Main.txt";
  }
}

function hasPartialScores(draft: ProblemPackageEditorDraft): boolean {
  return draft.groups.every((group) => group.score !== null);
}

function buildStatementMarkdown(input: ProblemPackageClientZipInput): string {
  const parts = [
    `# ${input.title.trim() || "Untitled Problem"}`,
    "",
    input.statementMarkdown.trim(),
    "",
    "## Input",
    input.inputDescription.trim(),
    "",
    "## Output",
    input.outputDescription.trim(),
    "",
    "## Constraints",
    input.constraintsMarkdown.trim(),
  ];

  if (input.explanationMarkdown.trim()) {
    parts.push("", "## Explanation", input.explanationMarkdown.trim());
  }

  return `${parts.join("\n")}\n`;
}

function buildConfig(input: ProblemPackageClientZipInput) {
  return {
    timeLimitMs: input.timeLimitMs,
    memoryLimitMb: input.memoryLimitMb,
    scoringType: hasPartialScores(input.draft) ? "sum_of_groups" : "binary",
    checkerType: input.draft.checkerType,
    checkerLanguage:
      input.draft.checkerType === "special_judge" ? input.draft.checkerLanguage : null,
    compareMode: input.draft.compareMode,
    problem: {
      slug: input.slug,
      visibility: input.visibility,
      explanationVisibility: input.explanationVisibility,
      difficulty: input.difficulty,
      testCaseVisibility: input.testCaseVisibility,
    },
    samples: input.draft.samples.map((sample) => ({
      name: sample.name,
      description: sample.description,
    })),
    groups: input.draft.groups.map((group) =>
      hasPartialScores(input.draft)
        ? {
            name: group.name,
            score: group.score,
          }
        : group.name,
    ),
  };
}

export async function buildProblemPackageZipBlob(
  input: ProblemPackageClientZipInput,
): Promise<Blob> {
  const zip = new JSZip();
  zip.file("statement.md", buildStatementMarkdown(input));
  zip.file("config.json", `${JSON.stringify(buildConfig(input), null, 2)}\n`);

  for (const sample of input.draft.samples) {
    zip.file(`samples/${sample.name}.in`, sample.input);
    zip.file(`samples/${sample.name}.out`, sample.output);
  }

  for (const group of input.draft.groups) {
    for (const testCase of group.tests) {
      zip.file(`tests/${group.name}/${testCase.name}.in`, testCase.input);
      zip.file(`tests/${group.name}/${testCase.name}.out`, testCase.output);
    }
  }

  if (input.draft.checkerType === "special_judge" && input.draft.checkerSourceCode.trim()) {
    zip.file(
      checkerSourceFileName(input.draft.checkerLanguage),
      input.draft.checkerSourceCode,
    );
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

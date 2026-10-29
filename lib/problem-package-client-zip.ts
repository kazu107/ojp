import { parseInteractiveLimits } from "./interactive-config";
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

function checkerSourceFileName(language: ProblemPackageEditorDraft["checkerLanguage"], interactive: boolean): string {
  switch (language) {
    case "cpp":
      return (interactive ? "interactor" : "checker") + "/Main.cpp";
    case "python":
      return (interactive ? "interactor" : "checker") + "/Main.py";
    case "java":
      return (interactive ? "interactor" : "checker") + "/Main.java";
    case "javascript":
      return (interactive ? "interactor" : "checker") + "/Main.js";
    default:
      return (interactive ? "interactor" : "checker") + "/Main.txt";
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
    judgeType: input.draft.checkerType === "interactive" ? "interactive" : "batch",
    interactorLanguage: input.draft.checkerType === "interactive" ? input.draft.checkerLanguage : undefined,
    interactive: input.draft.checkerType === "interactive" ? parseInteractiveLimits(input.draft.interactive) : undefined,
    checkerLanguage:
      input.draft.checkerType !== "exact" ? input.draft.checkerLanguage : null,
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
    if (input.draft.checkerType === "interactive" && sample.interaction !== undefined) zip.file(`samples/${sample.name}.interaction`, sample.interaction);
    zip.file(`samples/${sample.name}.in`, sample.input);
    zip.file(`samples/${sample.name}.out`, sample.output);
  }

  for (const group of input.draft.groups) {
    for (const testCase of group.tests) {
      zip.file(`tests/${group.name}/${testCase.name}.in`, testCase.input);
      if (input.draft.checkerType !== "interactive") zip.file(`tests/${group.name}/${testCase.name}.out`, testCase.output);
    }
  }

  if (input.draft.checkerType !== "exact" && input.draft.checkerSourceCode.trim()) {
    zip.file(
      checkerSourceFileName(input.draft.checkerLanguage, input.draft.checkerType === "interactive"),
      input.draft.checkerSourceCode,
    );
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

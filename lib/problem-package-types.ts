import { Language } from "@/lib/types";

export type ProblemPackageScoringType = "binary" | "sum_of_groups";
export type ProblemPackageCompareMode = "exact" | "ignore_trailing_spaces";
export type ProblemPackageCheckerType = "exact" | "special_judge";

export interface ProblemPackageEditorTestCase {
  id: string;
  name: string;
  input: string;
  output: string;
}

export interface ProblemPackageEditorSampleCase
  extends ProblemPackageEditorTestCase {
  description: string;
}

export interface ProblemPackageEditorGroup {
  id: string;
  name: string;
  score: number | null;
  tests: ProblemPackageEditorTestCase[];
}

export interface ProblemPackageEditorDraft {
  sourceLabel: string;
  checkerType: ProblemPackageCheckerType;
  checkerLanguage: Language;
  checkerSourceCode: string;
  compareMode: ProblemPackageCompareMode;
  zipSizeBytes: number;
  fileCount: number;
  samples: ProblemPackageEditorSampleCase[];
  warnings: string[];
  groups: ProblemPackageEditorGroup[];
}

export interface ProblemPackagePrefill {
  title: string;
  slugSuggestion: string;
  statementMarkdown: string;
  inputDescription: string;
  outputDescription: string;
  constraintsMarkdown: string;
  explanationMarkdown: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface ProblemPackageInspectResult {
  package: {
    fileName: string;
    zipSizeBytes: number;
    fileCount: number;
    samplePairs: number;
    testGroupCount: number;
    totalTestPairs: number;
    config: {
      timeLimitMs: number;
      memoryLimitMb: number;
      scoringType: ProblemPackageScoringType;
      checkerType: ProblemPackageCheckerType;
      checkerLanguage: Language | null;
      compareMode: ProblemPackageCompareMode;
      groups: Array<{
        name: string;
        score: number | null;
        tests: number;
      }>;
    };
    warnings: string[];
  };
  prefill: ProblemPackagePrefill;
  draft: ProblemPackageEditorDraft;
}

export const SUBMISSION_LANGUAGES = [
  "cpp",
  "python",
  "java",
  "javascript",
  "brainfuck",
] as const;
export type SubmissionLanguage = (typeof SUBMISSION_LANGUAGES)[number];

export const CHECKER_LANGUAGES = [
  "cpp",
  "python",
  "java",
  "javascript",
] as const;
export type CheckerLanguage = (typeof CHECKER_LANGUAGES)[number];

export const LEARNING_RUNTIME_LANGUAGES = [
  "python",
  "javascript",
  "brainfuck",
] as const;
export type LearningRuntimeLanguage =
  (typeof LEARNING_RUNTIME_LANGUAGES)[number];

export function isSubmissionLanguage(
  value: unknown,
): value is SubmissionLanguage {
  return SUBMISSION_LANGUAGES.some((language) => language === value);
}

export function isLearningRuntimeLanguage(
  value: unknown,
): value is LearningRuntimeLanguage {
  return LEARNING_RUNTIME_LANGUAGES.some((language) => language === value);
}

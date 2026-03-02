const DEFAULT_JUDGE_ENVIRONMENT_VERSION = "v1";

export function getJudgeEnvironmentVersion(): string {
  const configured = process.env.JUDGE_ENVIRONMENT_VERSION?.trim();
  if (configured) {
    return configured;
  }
  return DEFAULT_JUDGE_ENVIRONMENT_VERSION;
}

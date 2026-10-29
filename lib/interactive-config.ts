export interface InteractiveLimits {
  idleTimeLimitMs: number;
  wallTimeLimitMs: number;
  interactorTimeLimitMs: number;
}

export const DEFAULT_INTERACTIVE_LIMITS: InteractiveLimits = {
  idleTimeLimitMs: 5000,
  wallTimeLimitMs: 30000,
  interactorTimeLimitMs: 10000,
};

export function parseInteractiveLimits(raw: unknown): InteractiveLimits {
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error("config.interactive must be an object");
  }
  const value = (raw ?? {}) as Record<string, unknown>;
  const result = { ...DEFAULT_INTERACTIVE_LIMITS };
  for (const key of Object.keys(result) as Array<keyof InteractiveLimits>) {
    const number = value[key] ?? result[key];
    if (!Number.isSafeInteger(number) || Number(number) < 100 || Number(number) > 300000) {
      throw new Error(`config.interactive.${key} must be an integer between 100 and 300000`);
    }
    result[key] = Number(number);
  }
  if (result.idleTimeLimitMs > result.wallTimeLimitMs) {
    throw new Error("interactive idleTimeLimitMs must not exceed wallTimeLimitMs");
  }
  return result;
}

export function resolvePackageCheckerType(config: Record<string, unknown>): "exact" | "special_judge" | "interactive" {
  if (config.judgeType !== undefined && !["batch", "interactive"].includes(String(config.judgeType))) {
    throw new Error("config.judgeType must be batch or interactive");
  }
  if (config.judgeType === "batch" && config.checkerType === "interactive") {
    throw new Error("judgeType=batch conflicts with checkerType=interactive");
  }
  if (config.judgeType === "interactive" || config.checkerType === "interactive") return "interactive";
  if (config.checkerType === "special_judge" || config.checkerType === "custom_checker") return "special_judge";
  if (config.checkerType === undefined || config.checkerType === null || config.checkerType === "" || config.checkerType === "exact") return "exact";
  throw new Error("config.checkerType must be exact, special_judge or interactive");
}

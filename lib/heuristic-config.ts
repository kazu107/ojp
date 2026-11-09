export interface HeuristicConfig {
  direction: "maximize" | "minimize";
  evaluation: "absolute" | "relative";
  aggregate: "sum" | "mean";
  failurePolicy: "case_zero" | "submission_zero";
  finalGroups: string[];
  seeds: Record<string, string>;
  visualizer: "none" | "knapsack" | "route";
}

export const DEFAULT_HEURISTIC_CONFIG: HeuristicConfig = {
  direction: "maximize",
  evaluation: "absolute",
  aggregate: "sum",
  failurePolicy: "case_zero",
  finalGroups: [],
  seeds: {},
  visualizer: "none",
};

export function publicHeuristicSettings(
  value: HeuristicConfig | undefined,
): HeuristicConfig | undefined {
  return value ? { ...value, seeds: {} } : undefined;
}

export function parseHeuristicConfig(raw: unknown): HeuristicConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("config.heuristic must be an object");
  const value = raw as Record<string, unknown>;
  const result = { ...DEFAULT_HEURISTIC_CONFIG };
  for (const [key, allowed] of Object.entries({
    direction: ["maximize", "minimize"],
    evaluation: ["absolute", "relative"],
    aggregate: ["sum", "mean"],
    failurePolicy: ["case_zero", "submission_zero"],
    visualizer: ["none", "knapsack", "route"],
  })) {
    if (value[key] !== undefined && !allowed.includes(String(value[key])))
      throw new Error(`Invalid heuristic.${key}`);
    if (value[key] !== undefined) Object.assign(result, { [key]: value[key] });
  }
  if (
    value.finalGroups !== undefined &&
    (!Array.isArray(value.finalGroups) ||
      value.finalGroups.length > 100 ||
      value.finalGroups.some(
        (x) => typeof x !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(x),
      ))
  )
    throw new Error("Invalid heuristic.finalGroups");
  result.finalGroups = [...new Set((value.finalGroups ?? []) as string[])];
  if (
    value.seeds !== undefined &&
    (!value.seeds ||
      typeof value.seeds !== "object" ||
      Array.isArray(value.seeds))
  )
    throw new Error("Invalid heuristic.seeds");
  result.seeds = {};
  for (const [key, seed] of Object.entries(value.seeds ?? {})) {
    if (
      Object.keys(result.seeds).length >= 4000 ||
      key.length > 250 ||
      typeof seed !== "string" ||
      seed.length > 100
    )
      throw new Error("Invalid heuristic seed entry");
    result.seeds[key] = seed;
  }
  return result;
}

export function validateHeuristicGroups(
  config: HeuristicConfig,
  names: string[],
) {
  if (config.finalGroups.some((name) => !names.includes(name)))
    throw new Error("heuristic.finalGroups contains an unknown group");
  if (names.every((name) => config.finalGroups.includes(name)))
    throw new Error("At least one provisional group is required");
}

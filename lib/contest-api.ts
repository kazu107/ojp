import { ContestError, parseContestProblems } from "@/lib/contest";
import type { CreateContestInput, UpdateContestInput } from "@/lib/types";

export function readContestInput(
  body: Record<string, unknown>,
): UpdateContestInput {
  const result: Record<string, unknown> = {};
  for (const key of [
    "title",
    "slug",
    "descriptionMarkdown",
    "startAt",
    "endAt",
  ]) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string")
      throw new ContestError("Invalid contest settings.");
    result[key] = body[key];
  }
  for (const key of ["penaltyMinutes", "rated"])
    if (body[key] !== undefined) result[key] = body[key];
  for (const [key, allowed] of [
    ["visibility", ["public", "unlisted", "private"]],
    ["scoreboardVisibility", ["hidden", "partial", "full"]],
  ] as const) {
    if (body[key] === undefined) continue;
    if (
      typeof body[key] !== "string" ||
      !(allowed as readonly string[]).includes(body[key] as string)
    )
      throw new ContestError("Invalid contest visibility.");
    result[key] = body[key];
  }
  if (body.problems !== undefined)
    result.problems = parseContestProblems(body.problems);
  return result as UpdateContestInput;
}

export function newContestInput(
  body: Record<string, unknown>,
): CreateContestInput {
  return {
    title: "",
    slug: "",
    descriptionMarkdown: "",
    visibility: "public",
    startAt: new Date().toISOString(),
    endAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    penaltyMinutes: 5,
    scoreboardVisibility: "full",
    rated: false,
    problems: [],
    ...readContestInput(body),
  };
}

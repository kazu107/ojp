import type {
  Contest,
  ContestProblem,
  CreateContestInput,
  Problem,
  RatingChange,
  ContestRatingResult,
  ScoreboardRow,
  Submission,
  User,
  VirtualParticipation,
} from "@/lib/types";
import {
  isFinalSubmissionStatus,
  isWaitingSubmissionStatus,
} from "@/lib/submission-status";

export class ContestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function contestStatus(
  contest: Pick<Contest, "startAt" | "endAt">,
  now = Date.now(),
) {
  if (now < Date.parse(contest.startAt)) return "scheduled" as const;
  return now < Date.parse(contest.endAt)
    ? ("running" as const)
    : ("ended" as const);
}

export function canAccessContest(
  contest: Contest,
  user: User | null,
  direct = true,
): boolean {
  return (
    user?.role === "admin" ||
    user?.id === contest.organizerId ||
    contest.visibility === "public" ||
    (direct && contest.visibility === "unlisted")
  );
}

export function validateContest(
  input: CreateContestInput,
  problems: Problem[],
  user: User,
): void {
  if (!input.title.trim() || input.title.length > 200)
    throw new ContestError(
      "Contest title is required (maximum 200 characters).",
    );
  if (
    !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(input.slug) ||
    input.slug.length > 100
  )
    throw new ContestError(
      "Contest slug must use ASCII letters, digits and hyphens (maximum 100 characters).",
    );
  if (input.descriptionMarkdown.length > 200_000)
    throw new ContestError("Contest description is too long.");
  const start = Date.parse(input.startAt),
    end = Date.parse(input.endAt);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 31 * 86400_000
  )
    throw new ContestError(
      "Contest duration must be positive and at most 31 days.",
    );
  if (
    !Number.isSafeInteger(input.penaltyMinutes) ||
    input.penaltyMinutes < 0 ||
    input.penaltyMinutes > 1440
  )
    throw new ContestError(
      "Penalty must be an integer between 0 and 1440 minutes.",
    );
  if (
    !["public", "unlisted", "private"].includes(input.visibility) ||
    !["hidden", "partial", "full"].includes(input.scoreboardVisibility)
  )
    throw new ContestError("Invalid contest visibility.");
  if (input.rated !== undefined && typeof input.rated !== "boolean")
    throw new ContestError("Rated must be a boolean.");
  if (input.rated && input.visibility !== "public")
    throw new ContestError("Rated contests must be public.");
  if (input.problems.length < 1 || input.problems.length > 100)
    throw new ContestError("Select between 1 and 100 contest problems.");
  const ids = new Set<string>(),
    labels = new Set<string>(),
    orders = new Set<number>();
  for (const item of input.problems) {
    if (
      ids.has(item.problemId) ||
      labels.has(item.label) ||
      orders.has(item.orderIndex)
    )
      throw new ContestError(
        "Contest problem IDs, labels and ordering must be unique.",
      );
    if (
      !/^[A-Za-z0-9_-]{1,16}$/.test(item.label) ||
      !Number.isSafeInteger(item.orderIndex) ||
      item.orderIndex < 0
    )
      throw new ContestError("Invalid contest problem label or ordering.");
    if (
      !Number.isSafeInteger(item.score) ||
      item.score < 1 ||
      item.score > 1_000_000
    )
      throw new ContestError(
        "Problem points must be an integer between 1 and 1000000.",
      );
    const problem = problems.find((p) => p.id === item.problemId);
    if (
      !problem ||
      (problem.visibility !== "public" &&
        problem.authorId !== user.id &&
        user.role !== "admin")
    )
      throw new ContestError("You cannot add this problem to a contest.", 403);
    ids.add(item.problemId);
    labels.add(item.label);
    orders.add(item.orderIndex);
  }
}

export function assertContestStructureEditable(
  previous: Contest,
  next: CreateContestInput,
  now = Date.now(),
) {
  if (contestStatus(previous, now) === "scheduled") return;
  const signature = (value: CreateContestInput) =>
    JSON.stringify([
      value.startAt,
      value.endAt,
      value.penaltyMinutes,
      !!value.rated,
      [...value.problems]
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((p) => [p.problemId, p.label, p.score, p.orderIndex]),
    ]);
  if (signature(previous) !== signature(next))
    throw new ContestError(
      "Timing, problem set, points, penalty and Rated settings are locked after the contest starts.",
      409,
    );
  if (previous.rated && next.visibility !== "public")
    throw new ContestError("A started Rated contest must remain public.", 409);
}

export function contestPoints(rawScore: number, maximum: number): number {
  const score = Number.isFinite(rawScore)
    ? Math.max(0, Math.min(100, rawScore))
    : 0;
  return Math.round(score * maximum) / 100;
}

export function isOfficialSubmission(
  submission: Submission,
  contest: Contest,
): boolean {
  const time = Date.parse(submission.submittedAt);
  return (
    submission.contestId === contest.id &&
    !submission.virtualParticipationId &&
    contest.participantUserIds.includes(submission.userId) &&
    time >= Date.parse(contest.startAt) &&
    time < Date.parse(contest.endAt) &&
    contest.problems.some((p) => p.problemId === submission.problemId)
  );
}

export function virtualIsRunning(
  session: VirtualParticipation,
  now = Date.now(),
): boolean {
  return (
    !session.finishedAt &&
    now >= Date.parse(session.startedAt) &&
    now < Date.parse(session.endAt)
  );
}

export function compareStandings(a: ScoreboardRow, b: ScoreboardRow): number {
  return (
    b.totalScore - a.totalScore ||
    a.penalty - b.penalty ||
    (a.lastAcceptedAt ? Date.parse(a.lastAcceptedAt) : Infinity) -
      (b.lastAcceptedAt ? Date.parse(b.lastAcceptedAt) : Infinity) ||
    0
  );
}

export function calculateStandings(
  contest: Contest,
  submissions: Submission[],
  virtual?: VirtualParticipation,
): ScoreboardRow[] {
  const start = virtual?.startedAt ?? contest.startAt;
  const end = virtual
    ? new Date(
        Math.min(
          Date.parse(virtual.endAt),
          virtual.finishedAt ? Date.parse(virtual.finishedAt) : Infinity,
        ),
      ).toISOString()
    : contest.endAt;
  const participants = virtual
    ? [virtual.userId]
    : [...new Set(contest.participantUserIds)];
  const scoped = submissions.filter(
    (s) =>
      (virtual
        ? s.contestId === contest.id &&
          s.virtualParticipationId === virtual.id &&
          s.userId === virtual.userId &&
          Date.parse(s.submittedAt) >= Date.parse(start) &&
          Date.parse(s.submittedAt) < Date.parse(end)
        : isOfficialSubmission(s, contest)) &&
      isFinalSubmissionStatus(s.status) &&
      !["cancelled", "internal_error"].includes(s.status),
  );
  const rows = participants.map((userId) => {
    const cells = [...contest.problems]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((problem) => {
        const attempts = scoped
          .filter(
            (s) => s.userId === userId && s.problemId === problem.problemId,
          )
          .sort(
            (a, b) =>
              Date.parse(a.submittedAt) - Date.parse(b.submittedAt) ||
              a.id.localeCompare(b.id),
          );
        const maximum = attempts.reduce(
          (max, s) => Math.max(max, contestPoints(s.score, problem.score)),
          0,
        );
        // Tie-break on the first submission reaching the best score, including partial scores.
        const best =
          maximum > 0
            ? attempts.find(
                (s) => contestPoints(s.score, problem.score) === maximum,
              )
            : undefined;
        return {
          label: problem.label,
          score: maximum,
          acceptedAt: best?.submittedAt ?? null,
          wrongSubmissions: best
            ? attempts
                .slice(0, attempts.indexOf(best))
                .filter(
                  (s) =>
                    s.status !== "accepted" && s.status !== "compilation_error",
                ).length
            : 0,
        };
      });
    const times = cells.flatMap((cell) =>
      cell.acceptedAt ? [Date.parse(cell.acceptedAt)] : [],
    );
    return {
      userId,
      rank: 0,
      totalScore:
        Math.round(cells.reduce((sum, c) => sum + c.score, 0) * 100) / 100,
      penalty: cells.reduce(
        (sum, c) =>
          sum +
          (c.acceptedAt
            ? Math.floor(
                (Date.parse(c.acceptedAt) - Date.parse(start)) / 60000,
              ) +
              (c.score ===
              contest.problems.find((p) => p.label === c.label)?.score
                ? c.wrongSubmissions * contest.penaltyMinutes
                : 0)
            : 0),
        0,
      ),
      lastAcceptedAt: times.length
        ? new Date(Math.max(...times)).toISOString()
        : null,
      cells,
    };
  });
  rows.sort(
    (a, b) => compareStandings(a, b) || a.userId.localeCompare(b.userId),
  );
  rows.forEach((row, index) => {
    row.rank =
      index && compareStandings(rows[index - 1], row) === 0
        ? rows[index - 1].rank
        : index + 1;
  });
  return rows;
}

export function calculateRatings(
  contests: Contest[],
  submissions: Submission[],
  problems: Problem[],
  now = Date.now(),
) {
  const ratings = new Map<string, number>();
  const history: RatingChange[] = [];
  const results = new Map<string, ContestRatingResult>();
  let earlierPending = false;
  for (const contest of [...contests].sort(
    (a, b) =>
      Date.parse(a.endAt) - Date.parse(b.endAt) || a.id.localeCompare(b.id),
  )) {
    let status: ContestRatingResult["status"] = "unrated";
    const changes: RatingChange[] = [];
    if (contest.rated && contest.visibility === "public") {
      const attempts = submissions.filter((s) =>
        isOfficialSubmission(s, contest),
      );
      const excluded = new Set([
        contest.organizerId,
        ...contest.problems.flatMap((p) => {
          const problem = problems.find((item) => item.id === p.problemId);
          return problem ? [problem.authorId] : [];
        }),
      ]);
      const eligibleAttempts = attempts.filter(
        (s) => s.status !== "cancelled" && !excluded.has(s.userId),
      );
      const eligible = new Set(eligibleAttempts.map((s) => s.userId));
      if (contestStatus(contest, now) !== "ended") status = "running";
      else if (eligible.size < 2) status = "insufficient_participants";
      else if (
        earlierPending ||
        eligibleAttempts.some(
          (s) =>
            isWaitingSubmissionStatus(s.status) ||
            s.status === "internal_error",
        )
      ) {
        status = "waiting_judge";
        earlierPending = true;
      } else {
        const rows = calculateStandings(contest, submissions).filter((row) =>
          eligible.has(row.userId),
        );
        if (rows.length < 2) status = "insufficient_participants";
        else {
          status = "calculated";
          // All opponents use pre-event ratings; a tied result is a half-win.
          const previous = new Map(
            rows.map((row) => [row.userId, ratings.get(row.userId) ?? 1500]),
          );
          for (const row of rows) {
            let difference = 0;
            for (const other of rows)
              if (other.userId !== row.userId) {
                const expected =
                  1 /
                  (1 +
                    10 **
                      ((previous.get(other.userId)! -
                        previous.get(row.userId)!) /
                        400));
                const comparison = compareStandings(row, other);
                difference +=
                  (comparison < 0 ? 1 : comparison > 0 ? 0 : 0.5) - expected;
              }
            const before = previous.get(row.userId)!;
            const after = Math.max(
              0,
              Math.round(before + (32 * difference) / (rows.length - 1)),
            );
            changes.push({
              contestId: contest.id,
              contestTitle: contest.title,
              endAt: contest.endAt,
              userId: row.userId,
              rank: row.rank,
              previousRating: before,
              rating: after,
              delta: after - before,
            });
          }
          for (const change of changes)
            ratings.set(change.userId, change.rating);
          history.push(...changes);
        }
      }
    }
    results.set(contest.id, { status, changes });
  }
  return { ratings, history, results };
}

export function parseContestProblems(
  raw: unknown,
): ContestProblem[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw))
    throw new ContestError("Invalid contest problem set.");
  return raw.map((item, index) => {
    if (!item || typeof item !== "object")
      throw new ContestError("Invalid contest problem set.");
    const value = item as Record<string, unknown>;
    return {
      problemId: typeof value.problemId === "string" ? value.problemId : "",
      label:
        typeof value.label === "string"
          ? value.label
          : String.fromCharCode(65 + index),
      score: value.score === undefined ? 100 : (value.score as number),
      orderIndex:
        value.orderIndex === undefined ? index : (value.orderIndex as number),
    };
  });
}

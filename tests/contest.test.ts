import assert from "node:assert/strict";
import test from "node:test";
import {
  assertContestStructureEditable,
  calculateRatings,
  calculateStandings,
  canAccessContest,
  contestPoints,
  contestStatus,
  isOfficialSubmission,
  parseContestProblems,
  validateContest,
  virtualIsRunning,
} from "../lib/contest";
import type {
  Contest,
  Problem,
  Submission,
  User,
  VirtualParticipation,
} from "../lib/types";

const start = Date.parse("2026-01-01T00:00:00Z"),
  end = start + 3600_000,
  now = end + 3600_000;
const iso = (offset: number) => new Date(start + offset).toISOString();
const user: User = {
  id: "org",
  username: "org",
  displayName: "Organizer",
  bio: "",
  role: "contest_organizer",
  status: "active",
  displayNameChangedAt: null,
  createdAt: iso(0),
  updatedAt: iso(0),
};
const problem = {
  id: "p",
  authorId: "author",
  visibility: "public",
} as Problem;
function event(change: Partial<Contest> = {}): Contest {
  return {
    id: "c",
    organizerId: "org",
    title: "Contest",
    slug: "contest",
    descriptionMarkdown: "",
    visibility: "public",
    startAt: iso(0),
    endAt: iso(3600_000),
    penaltyMinutes: 5,
    scoreboardVisibility: "full",
    rated: true,
    problems: [{ problemId: "p", label: "A", score: 500, orderIndex: 0 }],
    participantUserIds: ["a", "b", "org", "author"],
    createdAt: iso(-1),
    updatedAt: iso(-1),
    ...change,
  };
}
function submission(
  id: string,
  userId: string,
  score: number,
  minutes: number,
  change: Partial<Submission> = {},
): Submission {
  return {
    id,
    userId,
    problemId: "p",
    contestId: "c",
    language: "javascript",
    sourceCode: "",
    status: score === 100 ? "accepted" : "wrong_answer",
    score,
    totalTimeMs: 1,
    peakMemoryKb: 1,
    submittedAt: iso(minutes * 60000),
    judgeStartedAt: iso(0),
    judgedAt: iso(0),
    judgeEnvironmentVersion: "test",
    testResults: [],
    ...change,
  };
}

test("points scale partial scores to arbitrary maxima with two decimal precision", () => {
  assert.equal(contestPoints(100, 500), 500);
  assert.equal(contestPoints(50, 500), 250);
  assert.equal(contestPoints(33, 333), 109.89);
  assert.equal(contestPoints(120, 500), 500);
  assert.equal(contestPoints(-1, 500), 0);
  assert.equal(contestPoints(NaN, 500), 0);
});
test("server windows are start-inclusive and end-exclusive", () => {
  const c = event();
  assert.equal(contestStatus(c, start - 1), "scheduled");
  assert.equal(contestStatus(c, start), "running");
  assert.equal(contestStatus(c, end - 1), "running");
  assert.equal(contestStatus(c, end), "ended");
  assert.equal(isOfficialSubmission(submission("s", "a", 100, 60), c), false);
  assert.equal(isOfficialSubmission(submission("s", "a", 100, 0), c), true);
});
test("official standings exclude virtual, out-of-window, outsider and unfinished submissions", () => {
  const rows = calculateStandings(event(), [
    submission("before", "a", 100, -1),
    submission("after", "a", 100, 60),
    submission("virtual", "a", 100, 1, { virtualParticipationId: "v" }),
    submission("queued", "a", 100, 2, { status: "queued" }),
    submission("outsider", "x", 100, 3),
    submission("other", "a", 100, 4, { contestId: "other" }),
    submission("valid", "b", 50, 1),
  ]);
  assert.equal(rows.find((r) => r.userId === "a")!.totalScore, 0);
  assert.equal(rows[0].totalScore, 250);
  assert.equal(
    rows.some((r) => r.userId === "x"),
    false,
  );
});
test("best partial score uses its first achievement time and ignores CE/IE/cancel penalties", () => {
  const rows = calculateStandings(event(), [
    submission("ie", "a", 0, 1, { status: "internal_error" }),
    submission("ce", "a", 0, 2, { status: "compilation_error" }),
    submission("cancel", "a", 0, 3, { status: "cancelled" }),
    submission("wa", "a", 0, 4),
    submission("partial", "a", 50, 8),
    submission("same", "a", 50, 9),
  ]);
  const a = rows.find((r) => r.userId === "a")!;
  assert.equal(a.totalScore, 250);
  assert.equal(a.penalty, 8);
  assert.equal(a.cells[0].wrongSubmissions, 1);
  assert.equal(a.cells[0].acceptedAt, iso(8 * 60000));
});
test("tied standings share ranks and Elo treats them as half-wins", () => {
  const c = event({ participantUserIds: ["a", "b"] });
  const s = [submission("1", "a", 100, 10), submission("2", "b", 100, 10)];
  assert.deepEqual(
    calculateStandings(c, s).map((r) => r.rank),
    [1, 1],
  );
  assert.deepEqual(
    calculateRatings([c], s, [problem], now).history.map((h) => h.delta),
    [0, 0],
  );
});
test("two equal-rated participants get plus/minus 16 for a decisive result", () => {
  const result = calculateRatings(
    [event()],
    [submission("1", "a", 50, 5), submission("2", "b", 100, 10)],
    [problem],
    now,
  );
  assert.equal(result.ratings.get("a"), 1484);
  assert.equal(result.ratings.get("b"), 1516);
  assert.equal(result.results.get("c")!.status, "calculated");
});
test("organizers, authors, virtual participants and join-only users are not rated", () => {
  const s = [
    submission("1", "org", 100, 1),
    submission("2", "author", 100, 1),
    submission("3", "a", 100, 2),
    submission("4", "b", 100, 3, { virtualParticipationId: "v" }),
  ];
  const result = calculateRatings([event()], s, [problem], now);
  assert.equal(result.results.get("c")!.status, "insufficient_participants");
  assert.equal(result.history.length, 0);
});
test("legacy contests and non-public events do not retroactively create ratings", () => {
  for (const c of [
    event({ rated: undefined }),
    event({ visibility: "private" }),
    event({ visibility: "unlisted" }),
  ]) {
    const result = calculateRatings(
      [c],
      [submission("1", "a", 100, 1), submission("2", "b", 0, 1)],
      [problem],
      now,
    );
    assert.equal(result.history.length, 0);
    assert.equal(result.results.get("c")!.status, "unrated");
  }
});
test("pending judgments and infrastructure errors defer later rating calculations", () => {
  for (const status of ["queued", "internal_error"] as const) {
    const first = event(),
      second = event({ id: "d", startAt: iso(3600_000), endAt: iso(7200_000) });
    const s = [
      submission("1", "a", 100, 1, { status }),
      submission("2", "b", 0, 1),
      submission("3", "a", 100, 70, { contestId: "d" }),
      submission("4", "b", 0, 70, { contestId: "d" }),
    ];
    const result = calculateRatings(
      [second, first],
      s,
      [problem],
      start + 10800_000,
    );
    assert.equal(result.results.get("c")!.status, "waiting_judge");
    assert.equal(result.results.get("d")!.status, "waiting_judge");
    assert.equal(result.history.length, 0);
  }
});
test("ineligible or insufficient events never block later ratings", () => {
  const first = event();
  const second = event({
    id: "d",
    startAt: iso(3600_000),
    endAt: iso(7200_000),
  });
  const later = [
    submission("3", "a", 100, 70, { contestId: "d" }),
    submission("4", "b", 0, 70, { contestId: "d" }),
  ];
  const insufficient = calculateRatings(
    [first, second],
    [submission("1", "a", 0, 1, { status: "internal_error" }), ...later],
    [problem],
    start + 10800_000,
  );
  assert.equal(
    insufficient.results.get("c")!.status,
    "insufficient_participants",
  );
  assert.equal(insufficient.results.get("d")!.status, "calculated");
  const excluded = calculateRatings(
    [first],
    [
      submission("1", "a", 100, 1),
      submission("2", "b", 0, 1),
      submission("5", first.organizerId, 0, 1, { status: "internal_error" }),
      submission("6", problem.authorId, 0, 1, { status: "queued" }),
    ],
    [problem],
    now,
  );
  assert.equal(excluded.results.get("c")!.status, "calculated");
});

test("rating recomputation is chronological, repeatable and rejudge-safe", () => {
  const c = event(),
    d = event({ id: "d", startAt: iso(3600_000), endAt: iso(7200_000) });
  const s = [
    submission("1", "a", 100, 1),
    submission("2", "b", 0, 1),
    submission("3", "a", 100, 70, { contestId: "d" }),
    submission("4", "b", 0, 70, { contestId: "d" }),
  ];
  const before = calculateRatings([d, c], s, [problem], start + 10800_000);
  assert.deepEqual(
    before.history,
    calculateRatings([c, d], [...s].reverse(), [problem], start + 10800_000)
      .history,
  );
  assert.equal(before.ratings.get("a"), 1531);
  const changed = calculateRatings(
    [c, d],
    s.map((item) => ({ ...item, userId: item.userId === "a" ? "b" : "a" })),
    [problem],
    start + 10800_000,
  );
  assert.equal(changed.ratings.get("b"), 1531);
  assert.equal(changed.ratings.get("a"), 1469);
});
test("public, unlisted direct access and private organizer/admin authorization", () => {
  assert.equal(canAccessContest(event(), null), true);
  assert.equal(canAccessContest(event({ visibility: "unlisted" }), null), true);
  assert.equal(
    canAccessContest(event({ visibility: "unlisted" }), null, false),
    false,
  );
  const privateEvent = event({ visibility: "private" });
  assert.equal(canAccessContest(privateEvent, null), false);
  assert.equal(
    canAccessContest(privateEvent, { ...user, id: "stranger" }),
    false,
  );
  assert.equal(canAccessContest(privateEvent, user), true);
  assert.equal(
    canAccessContest(privateEvent, { ...user, id: "admin", role: "admin" }),
    true,
  );
});
test("contest validation rejects malformed points, duplicates, windows and unknown problems", () => {
  const c = event();
  validateContest(c, [problem], user);
  for (const score of [0, -1, 1.5, Infinity, "500", 1000001])
    assert.throws(() =>
      validateContest(
        { ...c, problems: [{ ...c.problems[0], score: score as number }] },
        [problem],
        user,
      ),
    );
  for (const change of [
    { startAt: "invalid" },
    { endAt: c.startAt },
    { rated: true, visibility: "private" as const },
    { problems: [] },
    { problems: [c.problems[0], { ...c.problems[0], orderIndex: 1 }] },
    { slug: "bad slug" },
    { penaltyMinutes: 1.5 },
  ])
    assert.throws(() => validateContest({ ...c, ...change }, [problem], user));
  assert.throws(
    () => validateContest(c, [{ ...problem, visibility: "private" }], user),
    /cannot add/,
  );
  assert.throws(() => validateContest(c, [], user), /cannot add/);
});
test("settings lock only structural fields after start, with canonical property order", () => {
  const c = event();
  assert.doesNotThrow(() =>
    assertContestStructureEditable(c, { ...c, title: "Renamed" }, now),
  );
  assert.doesNotThrow(() =>
    assertContestStructureEditable(
      c,
      {
        ...c,
        problems: [{ score: 500, orderIndex: 0, label: "A", problemId: "p" }],
      },
      now,
    ),
  );
  for (const change of [
    { endAt: iso(7200_000) },
    { rated: false },
    { penaltyMinutes: 0 },
    { problems: [{ ...c.problems[0], score: 200 }] },
  ])
    assert.throws(
      () => assertContestStructureEditable(c, { ...c, ...change }, now),
      /locked/,
    );
  assert.throws(
    () =>
      assertContestStructureEditable(c, { ...c, visibility: "private" }, now),
    /remain public/,
  );
  assert.doesNotThrow(() =>
    assertContestStructureEditable(c, { ...c, rated: false }, start - 1),
  );
});
test("virtual standings use the personal start and earliest end, never official attempts", () => {
  const v: VirtualParticipation = {
    id: "v",
    contestId: "c",
    userId: "a",
    startedAt: iso(7200_000),
    endAt: iso(10800_000),
    finishedAt: iso(7500_000),
  };
  assert.equal(
    virtualIsRunning({ ...v, finishedAt: null }, start + 7300_000),
    true,
  );
  assert.equal(virtualIsRunning(v, start + 7300_000), false);
  assert.equal(
    virtualIsRunning({ ...v, finishedAt: null }, start + 10800_000),
    false,
  );
  const rows = calculateStandings(
    event(),
    [
      submission("official", "a", 100, 1),
      submission("virtual", "a", 50, 122, { virtualParticipationId: "v" }),
      submission("late", "a", 100, 126, { virtualParticipationId: "v" }),
    ],
    v,
  );
  assert.equal(rows[0].totalScore, 250);
  assert.equal(rows[0].penalty, 2);
});
test("API problem parser rejects invalid container types instead of dropping entries", () => {
  assert.throws(() => parseContestProblems("bad"));
  assert.throws(() => parseContestProblems([null]));
  assert.equal(parseContestProblems(undefined), undefined);
  assert.equal(parseContestProblems([{ problemId: "p" }])![0].score, 100);
});

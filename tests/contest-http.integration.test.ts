import assert from "node:assert/strict";
import test from "node:test";
import { encode } from "next-auth/jwt";
import AdmZip from "adm-zip";

test(
  "local HTTP contest lifecycle with real worker: permissions, partial points, Elo, virtual attempts and rejudging",
  {
    skip: !process.env.CONTEST_HTTP_TEST_ORIGIN,
    timeout: 180_000,
  },
  async () => {
    const origin = new URL(process.env.CONTEST_HTTP_TEST_ORIGIN!);
    assert.equal(
      origin.origin,
      "http://127.0.0.1:3100",
      "Use the disposable local validation server only.",
    );
    const db = new URL(process.env.CONTEST_TEST_DATABASE_URL!);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(db.hostname) &&
        db.pathname === "/ojp_contest_test",
      "The HTTP server must use the disposable contest database.",
    );
    const cookie = async (login: string) =>
      `authjs.session-token=${await encode({
        secret: "contest-local-validation-only-not-production",
        salt: "authjs.session-token",
        token: {
          sub: login,
          oauthProvider: "github",
          oauthAccountId: login,
          oauthLogin: login,
          oauthName: login,
        },
        maxAge: 3600,
      })}`;
    const admin = await cookie("contest-test"),
      alice = await cookie("contest-alice"),
      bob = await cookie("contest-bob");
    async function request(
      path: string,
      auth?: string,
      method = "GET",
      body?: unknown,
    ): Promise<Response> {
      return fetch(origin.origin + path, {
        method,
        headers: {
          ...(auth ? { Cookie: auth } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    }
    async function json(
      path: string,
      auth?: string,
      method = "GET",
      body?: unknown,
      status = 200,
    ) {
      const response = await request(path, auth, method, body);
      const value = await response.json();
      assert.equal(
        response.status,
        status,
        `${path}: ${JSON.stringify(value)}`,
      );
      return value;
    }
    async function until<T>(
      read: () => Promise<T>,
      match: (value: T) => boolean,
      timeout = 45000,
    ) {
      const deadline = Date.now() + timeout;
      let value: T;
      do {
        value = await read();
        if (match(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 500));
      } while (Date.now() < deadline);
      assert.fail(`Timed out: ${JSON.stringify(value!)}`);
    }
    const me = await json("/api/me", admin),
      a = await json("/api/me", alice),
      b = await json("/api/me", bob);
    assert.equal(me.user.role, "admin");
    assert.equal(a.user.role, "user");
    for (const old of (await json("/api/contests", admin)).contests as Array<{
      id: string;
      slug: string;
    }>) {
      if (/^contest-(validation|private|unlisted)-\d+$/.test(old.slug))
        await json(`/api/admin/contests/${old.id}/delete`, admin, "POST", {
          reason: "Remove earlier disposable contest test",
        });
    }
    const suffix = Date.now();
    const p = (
      await json(
        "/api/problems",
        admin,
        "POST",
        {
          title: "Contest Test Sum",
          slug: `contest-sum-${suffix}`,
          visibility: "private",
          statementMarkdown: "Read two integers and print their sum.",
          timeLimitMs: 1500,
          memoryLimitMb: 128,
        },
        201,
      )
    ).problem;
    const zip = new AdmZip();
    zip.addFile(
      "statement.md",
      Buffer.from("Read two integers and print their sum.\n"),
    );
    zip.addFile(
      "config.json",
      Buffer.from(
        JSON.stringify({
          timeLimitMs: 1500,
          memoryLimitMb: 128,
          groups: [
            { name: "one", score: 50 },
            { name: "two", score: 50 },
          ],
          compareMode: "ignore_trailing_spaces",
        }),
      ),
    );
    zip.addFile("tests/one/1.in", Buffer.from("2 3\n"));
    zip.addFile("tests/one/1.out", Buffer.from("5\n"));
    zip.addFile("tests/two/1.in", Buffer.from("5 6\n"));
    zip.addFile("tests/two/1.out", Buffer.from("11\n"));
    zip.addFile("samples/1.in", Buffer.from("2 3\n"));
    zip.addFile("samples/1.out", Buffer.from("5\n"));
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(zip.toBuffer())]), "sum.zip");
    const upload = await fetch(
      origin.origin + `/api/problems/${p.id}/package`,
      { method: "POST", headers: { Cookie: admin }, body: form },
    );
    assert.equal(upload.status, 201, await upload.text());
    const settings = {
      title: "Validation Contest",
      slug: `contest-validation-${suffix}`,
      visibility: "public",
      descriptionMarkdown: "Local disposable validation only.",
      startAt: new Date(Date.now() + 8000).toISOString(),
      endAt: new Date(Date.now() + 35000).toISOString(),
      penaltyMinutes: 5,
      scoreboardVisibility: "full",
      rated: true,
      problems: [{ problemId: p.id, label: "A", score: 500, orderIndex: 0 }],
    };
    await json("/api/contests", undefined, "POST", settings, 401);
    await json("/api/contests", alice, "POST", settings, 403);
    await json(
      "/api/contests",
      admin,
      "POST",
      { ...settings, problems: [{ ...settings.problems[0], score: -1 }] },
      400,
    );
    const c = (await json("/api/contests", admin, "POST", settings, 201))
        .contest,
      base = `/api/contests/${c.id}`;
    await json(base + "/join", alice, "POST");
    await json(base + "/join", alice, "POST");
    await json(`/api/admin/users/${a.user.id}/freeze`, admin, "POST", {
      reason: "Contest permission test",
    });
    await json(base + "/join", alice, "POST", undefined, 403);
    await json(`/api/admin/users/${a.user.id}/unfreeze`, admin, "POST", {
      reason: "Contest permission test complete",
    });
    const joined = await json(base, alice);
    assert.equal(
      joined.contest.participantUserIds.filter((id: string) => id === a.user.id)
        .length,
      1,
    );
    await json(
      `/api/problems/${p.id}?contestId=${c.id}`,
      alice,
      "GET",
      undefined,
      404,
    );
    await json(
      "/api/submissions",
      alice,
      "POST",
      {
        problemId: p.id,
        contestId: c.id,
        language: "javascript",
        sourceCode: "console.log(5)",
      },
      403,
    );
    await json(base + "/virtual", alice, "POST", { action: "start" }, 409);
    const privateContest = (
      await json(
        "/api/contests",
        admin,
        "POST",
        {
          ...settings,
          title: "Private Contest",
          slug: `contest-private-${suffix}`,
          visibility: "private",
          rated: false,
        },
        201,
      )
    ).contest;
    await json(
      `/api/contests/${privateContest.id}/join`,
      alice,
      "POST",
      undefined,
      404,
    );
    await json(
      `/api/contests/${privateContest.id}/scoreboard`,
      alice,
      "GET",
      undefined,
      404,
    );
    const unlisted = (
      await json(
        "/api/contests",
        admin,
        "POST",
        {
          ...settings,
          slug: `contest-unlisted-${suffix}`,
          visibility: "unlisted",
          rated: false,
        },
        201,
      )
    ).contest;
    assert.ok(
      !(await json("/api/contests", alice)).contests.some(
        (item: { id: string }) => item.id === unlisted.id,
      ),
    );
    await json(`/api/contests/${unlisted.id}/join`, alice, "POST");
    await until(
      () => json(base + "/scoreboard", alice),
      (value) => value.status === "running",
    );
    await json(`/api/problems/${p.id}?contestId=${c.id}`, alice);
    await json(`/api/problems/${p.id}`, alice, "GET", undefined, 404);
    await json(
      `/api/contests/${privateContest.id}/join`,
      bob,
      "POST",
      undefined,
      404,
    );
    await json(
      "/api/submissions",
      alice,
      "POST",
      {
        problemId: p.id,
        contestId: privateContest.id,
        language: "javascript",
        sourceCode: "console.log(5)",
      },
      404,
    );
    await json(
      base,
      admin,
      "PATCH",
      { problems: [{ ...settings.problems[0], score: 300 }] },
      409,
    );
    await json(base, alice, "PATCH", { title: "Unauthorized" }, 403);
    const correct =
      "console.log(require('node:fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number).reduce((a,b)=>a+b,0));";
    const first = (
      await json(
        "/api/submissions",
        alice,
        "POST",
        {
          problemId: p.id,
          contestId: c.id,
          language: "javascript",
          sourceCode: "console.log(5)",
        },
        201,
      )
    ).submission;
    const second = (
      await json(
        "/api/submissions",
        bob,
        "POST",
        {
          problemId: p.id,
          contestId: c.id,
          language: "javascript",
          sourceCode: correct,
        },
        201,
      )
    ).submission;
    const judgedA = await until(
      () => json(`/api/submissions/${first.id}`, alice),
      (value) => value.submission.judgedAt !== null,
    );
    const judgedB = await until(
      () => json(`/api/submissions/${second.id}`, bob),
      (value) => value.submission.judgedAt !== null,
    );
    assert.equal(judgedA.submission.score, 50);
    assert.equal(judgedB.submission.status, "accepted");
    assert.equal(judgedA.submission.testResults.length, 2);
    assert.equal(judgedB.submission.testResults.length, 2);
    const board = await until(
      () => json(base + "/scoreboard", alice),
      (value) =>
        value.rows.find((row: { userId: string }) => row.userId === b.user.id)
          ?.totalScore === 500,
    );
    assert.equal(
      board.rows.find((row: { userId: string }) => row.userId === a.user.id)
        .totalScore,
      250,
    );
    await json(base, admin, "PATCH", { scoreboardVisibility: "partial" });
    const partial = await json(base + "/scoreboard", bob);
    assert.equal(partial.detailLevel, "summary");
    assert.ok(
      partial.rows.every((row: { cells: unknown[] }) => row.cells.length === 0),
    );
    await json(base, admin, "PATCH", { scoreboardVisibility: "hidden" });
    assert.equal((await json(base + "/scoreboard", bob)).rows.length, 0);
    await json(base, admin, "PATCH", { scoreboardVisibility: "full" });
    const final = await until(
      () => json(base + "/scoreboard", alice),
      (value) =>
        value.status === "ended" && value.ratingResult.status === "calculated",
    );
    assert.equal(
      final.ratingResult.changes.find(
        (row: { userId: string }) => row.userId === b.user.id,
      ).rating,
      1516,
    );
    assert.equal(
      final.ratingResult.changes.find(
        (row: { userId: string }) => row.userId === a.user.id,
      ).rating,
      1484,
    );
    await json(base + "/join", bob, "POST", undefined, 403);
    const before = JSON.stringify(final.rows);
    const sessions = await Promise.all(
      Array.from({ length: 5 }, () =>
        json(base + "/virtual", alice, "POST", { action: "start" }),
      ),
    );
    const session = sessions[0].session;
    assert.equal(new Set(sessions.map((value) => value.session.id)).size, 1);
    await json(
      "/api/submissions",
      bob,
      "POST",
      {
        problemId: p.id,
        contestId: c.id,
        virtualParticipationId: session.id,
        language: "javascript",
        sourceCode: correct,
      },
      404,
    );
    const virtual = (
      await json(
        "/api/submissions",
        alice,
        "POST",
        {
          problemId: p.id,
          contestId: c.id,
          virtualParticipationId: session.id,
          language: "javascript",
          sourceCode: correct,
        },
        201,
      )
    ).submission;
    await until(
      () => json(`/api/submissions/${virtual.id}`, alice),
      (value) => value.submission.status === "accepted",
    );
    await json(`/api/submissions/${virtual.id}`, bob, "GET", undefined, 404);
    const virtualBoard = await until(
      () => json(base + "/scoreboard", alice),
      (value) => value.virtual.rows[0].totalScore === 500,
    );
    assert.equal(JSON.stringify(virtualBoard.rows), before);
    assert.deepEqual(virtualBoard.ratingResult, final.ratingResult);
    await json(base + "/virtual", alice, "POST", { action: "finish" });
    const restarted = await json(base + "/virtual", alice, "POST", {
      action: "start",
    });
    assert.equal(restarted.session.id, session.id);
    assert.ok(restarted.session.finishedAt);
    await json(
      "/api/submissions",
      alice,
      "POST",
      {
        problemId: p.id,
        contestId: c.id,
        virtualParticipationId: session.id,
        language: "javascript",
        sourceCode: correct,
      },
      409,
    );
    const practice = (
      await json(
        "/api/submissions",
        admin,
        "POST",
        {
          problemId: p.id,
          contestId: c.id,
          language: "javascript",
          sourceCode: correct,
        },
        201,
      )
    ).submission;
    assert.equal(practice.contestId, null);
    await json(`/api/submissions/${second.id}/rejudge`, admin, "POST", {
      reason: "Contest regression validation",
      detail: "Repeat without rating duplication",
    });
    await until(
      () => json(`/api/submissions/${second.id}`, bob),
      (value) => value.submission.status === "accepted",
    );
    const rejudged = await until(
      () => json(base + "/scoreboard", alice),
      (value) => value.ratingResult.status === "calculated",
    );
    assert.deepEqual(rejudged.ratingResult, final.ratingResult);
    const repeated = await json(`/api/submissions/${second.id}`, bob);
    assert.equal(repeated.submission.testResults.length, 2);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(
      (await json(`/api/submissions/${second.id}`, bob)).submission
        .judgeStartedAt,
      repeated.submission.judgeStartedAt,
    );
    assert.equal(
      (await json("/api/ratings")).ratings.find(
        (row: { userId: string }) => row.userId === b.user.id,
      ).rating,
      1516,
    );
    const pages = [
      `/contests/${c.id}`,
      `/contests/${c.id}/edit`,
      `/problems/${p.id}?contestId=${c.id}`,
      "/ratings",
      "/me",
    ];
    for (const lang of ["ja", "en"])
      for (const page of pages) {
        const response: Response = await fetch(origin.origin + page, {
          headers: { Cookie: `${admin}; ojp_locale=${lang}` },
        });
        assert.equal(response.status, 200);
        assert.ok((await response.text()).includes(`<html lang="${lang}"`));
      }
    console.log(
      JSON.stringify({
        contestId: c.id,
        alice: a.user.id,
        bob: b.user.id,
        partialPoints: 250,
        fullPoints: 500,
        ratings: [1484, 1516],
        virtualSession: session.id,
        rejudgeStable: true,
      }),
    );
  },
);

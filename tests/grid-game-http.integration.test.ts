import test from "node:test";
import assert from "node:assert/strict";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  gridGameExample,
  gridGameOracle,
  gridGamePythonSolution,
} from "../lib/grid-game-examples";
import { buildProblemPackageZip } from "../lib/problem-package";
import { sampleLearningDraft, newLearningItem } from "../lib/learning";

test(
  "isolated HTTP: games, preview ownership and limits, pinned scoring, learning and system tests",
  { skip: !process.env.GAME_TEST_ORIGIN, timeout: 180000 },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname === "/ojp_game_test",
      "Refusing non-test database",
    );
    assert.equal(process.env.GAME_TEST_ORIGIN, "http://127.0.0.1:3108");
    assert.equal(process.env.JUDGE_SANDBOX, "bubblewrap");
    const origin = process.env.GAME_TEST_ORIGIN!,
      db = new PrismaClient({ log: [] }),
      workers = [] as ReturnType<typeof spawn>[];
    let workerLog = "";
    const cookie = async (login: string) =>
      `authjs.session-token=${await encode({ secret: "game-local-validation-only", salt: "authjs.session-token", token: { sub: login, oauthProvider: "github", oauthAccountId: login, oauthLogin: login, oauthName: login }, maxAge: 7200 })}`;
    const admin = await cookie("game-test"),
      alice = await cookie("game-alice"),
      bob = await cookie("game-bob");
    async function request(
      path: string,
      auth = admin,
      method = "GET",
      body?: unknown,
      status = 200,
    ) {
      const response = await fetch(origin + path, {
        method,
        headers: {
          Cookie: auth,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      const json = await response.json();
      assert.equal(response.status, status, `${path}: ${JSON.stringify(json)}`);
      return json;
    }
    async function until<T>(
      read: () => Promise<T>,
      done: (value: T) => boolean,
    ) {
      const deadline = Date.now() + 90000;
      let value: T | undefined;
      do {
        value = await read();
        if (done(value)) return value;
        await new Promise((r) => setTimeout(r, 300));
      } while (Date.now() < deadline);
      throw Error("Timed out: " + JSON.stringify(value));
    }
    try {
      for (const auth of [admin, alice, bob])
        await request("/api/problems", auth);
      const example = gridGameExample("maze"),
        slug = `game-http-${randomUUID().slice(0, 8)}`;
      example.draft.heuristic!.seeds = { "system/case01": "hidden-game-seed" };
      const created = await request(
          "/api/problems",
          admin,
          "POST",
          { ...example, slug },
          201,
        ),
        id = created.problem.id;
      async function upload(settings: ReturnType<typeof gridGameExample>) {
        const zip = buildProblemPackageZip(settings),
          body = new FormData();
        body.set("file", new Blob([new Uint8Array(zip)]), "game.zip");
        const response = await fetch(`${origin}/api/problems/${id}/package`, {
          method: "POST",
          headers: { Cookie: admin },
          body,
        });
        assert.equal(response.status, 201, await response.text());
      }
      await upload(example);
      const endAt = new Date(Date.now() + 14000).toISOString();
      const { contest } = await request(
        "/api/contests",
        admin,
        "POST",
        {
          title: "Grid game contest",
          slug,
          descriptionMarkdown: "test",
          visibility: "unlisted",
          startAt: new Date(Date.now() - 1000).toISOString(),
          endAt,
          penaltyMinutes: 0,
          scoreboardVisibility: "full",
          rated: false,
          heuristic: { selection: "best" },
          problems: [{ problemId: id, label: "A", score: 1, orderIndex: 0 }],
        },
        201,
      );
      const source = gridGamePythonSolution("maze"),
        ownInput = "3 4\n####\n#SG#\n####\n",
        previewPath = `/api/problems/${id}/game-preview`;
      const body = { input: ownInput, sourceCode: source, language: "python" };
      const first = await request(previewPath, alice, "POST", body, 202),
        second = await request(previewPath, alice, "POST", body, 202);
      assert.equal(first.job.status, "queued");
      assert.notEqual(first.job.id, second.job.id);
      await request(previewPath, alice, "POST", body, 429);
      await request(
        `/api/package-jobs/${first.job.id}`,
        bob,
        "GET",
        undefined,
        403,
      );
      await request(previewPath, "", "POST", body, 401);
      await request(
        previewPath,
        bob,
        "POST",
        { ...body, input: "invalid" },
        400,
      );
      const cross = await fetch(origin + previewPath, {
        method: "POST",
        headers: {
          Cookie: alice,
          "Content-Type": "application/json",
          Origin: "https://untrusted.invalid",
        },
        body: JSON.stringify(body),
      });
      assert.equal(cross.status, 403);
      const stored = await db.packageJob.findUniqueOrThrow({
        where: { id: first.job.id },
      });
      assert.ok(
        !JSON.stringify(stored.storageRef).includes("hidden-game-seed"),
      );
      assert.ok(!JSON.stringify(stored.storageRef).includes("storageKey"));
      for (let i = 0; i < 2; i++) {
        const worker = spawn(
          process.execPath,
          ["--import", "tsx", "scripts/judge-worker.ts"],
          {
            env: {
              ...process.env,
              JUDGE_PROCESS_MODE: "worker",
              DYNO: `game-integration-${i}`,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        workers.push(worker);
        for (const stream of [worker.stdout, worker.stderr])
          stream?.on("data", (data) => {
            workerLog = (workerLog + data.toString()).slice(-1000000);
          });
      }
      const preview = await until(
        () => request(`/api/package-jobs/${first.job.id}`, alice),
        (value) =>
          value.job.status === "completed" || value.job.status === "failed",
      );
      assert.equal(preview.job.status, "completed", JSON.stringify(preview));
      assert.equal(preview.job.result.testResults.length, 1);
      assert.equal(
        preview.job.result.testResults[0].boardReplay.score,
        "100199",
      );
      assert.equal(
        preview.job.result.testResults[0].boardReplay.frames.length,
        2,
      );
      await until(
        () => request(`/api/package-jobs/${second.job.id}`, alice),
        (value) => value.job.status === "completed",
      );
      const submit = async (
        auth: string,
        sourceCode = source,
        contestId: string | null = null,
      ) =>
        (
          await request(
            "/api/submissions",
            auth,
            "POST",
            { problemId: id, contestId, language: "python", sourceCode },
            201,
          )
        ).submission.id as string;
      const goodId = await submit(alice, source, contest.id);
      const changed = gridGameExample("maze");
      changed.draft.heuristic!.game!.maxTurns = 333;
      await upload(changed);
      const wrongId = await submit(
        admin,
        "while True:\n h=input()\n if h=='END':break\n n=int(h.split()[0])\n for _ in range(n):input()\n print('STOP',flush=True)\n",
        contest.id,
      );
      const good = await until(
        () => request(`/api/submissions/${goodId}/heuristic`, alice),
        (value) => value.run?.status === "completed",
      );
      const expected = String(
        example.draft.groups[0].tests.reduce(
          (sum, c) => sum + Number(gridGameOracle(c.input, "maze")),
          0,
        ),
      );
      assert.equal(good.run.score, expected);
      assert.equal(good.run.groups[0].completed, 3);
      await until(
        () => request(`/api/submissions/${wrongId}/heuristic`),
        (value) => value.run?.status === "completed",
      );
      const guest = await request(`/api/submissions/${goodId}/heuristic`, "");
      assert.ok(!JSON.stringify(guest).includes("boardReplay"));
      assert.ok(!JSON.stringify(guest).includes("hidden-game-seed"));
      assert.deepEqual(guest.run.history, []);
      const pinnedPreview = await request(
        previewPath,
        bob,
        "POST",
        { ...body, contestId: contest.id },
        202,
      );
      const pinnedResult = await until(
        () => request(`/api/package-jobs/${pinnedPreview.job.id}`, bob),
        (value) => value.job.status === "completed",
      );
      assert.equal(
        pinnedResult.job.result.testResults[0].boardReplay.score,
        "100199",
      );
      assert.equal(
        await db.judgeJob.count({
          where: { submissionId: { in: [goodId, wrongId] } },
        }),
        0,
      );
      const frozen = await fetch(
        `${origin}/games/${id}?contestId=${contest.id}`,
        { headers: { Cookie: alice } },
      );
      assert.equal(frozen.status, 200);
      assert.ok((await frozen.text()).includes("game-workspace"));
      await request(`/api/problems/${id}`, admin, "PATCH", {
        visibility: "public",
      });
      const draft = sampleLearningDraft();
      draft.slug = `learn-${slug}`;
      draft.visibility = "unlisted";
      const practice = newLearningItem("problem", "game-practice");
      practice.problemId = id;
      draft.chapters[0].items.push(practice);
      const course = await request(
        "/api/learning/courses",
        admin,
        "POST",
        { draft },
        201,
      );
      const published = await request(
        `/api/learning/courses/${course.id}/publish`,
        admin,
        "POST",
        { editVersion: course.editVersion },
      );
      const lesson = await request(
        `/api/learning/courses/${course.id}/items/game-practice?version=${published.versionId}`,
        bob,
      );
      assert.equal(lesson.problem.heuristic.game.maxTurns, 333);
      assert.deepEqual(lesson.problem.heuristic.seeds, {});
      await request(
        `/api/learning/courses/${course.id}/progress`,
        bob,
        "POST",
        {
          versionId: published.versionId,
          itemId: "game-practice",
          action: "problem",
          submissionId: pinnedPreview.job.id,
        },
        400,
      );
      const latestId = await submit(bob);
      await until(
        () => request(`/api/submissions/${latestId}`),
        (value) => value.submission.status === "accepted",
      );
      await request(
        `/api/learning/courses/${course.id}/progress`,
        bob,
        "POST",
        {
          versionId: published.versionId,
          itemId: "game-practice",
          action: "problem",
          submissionId: latestId,
        },
      );
      const latest = await request(
        `/api/submissions/${latestId}/heuristic`,
        bob,
      );
      assert.equal(
        latest.run.score,
        String(Number(expected) + 3 * (333 - 200)),
      );
      await new Promise((r) =>
        setTimeout(r, Math.max(0, Date.parse(endAt) - Date.now() + 200)),
      );
      await request(
        `/api/contests/${contest.id}/heuristic/finalize`,
        admin,
        "POST",
        {},
      );
      const final = await until(
        () => request(`/api/contests/${contest.id}/scoreboard`, ""),
        (value) => value.heuristic?.state === "final",
      );
      assert.equal(
        final.rows[0].heuristicScore,
        String(
          example.draft.groups[1].tests.reduce(
            (sum, c) => sum + Number(gridGameOracle(c.input, "maze")),
            0,
          ),
        ),
      );
      const system = await request(
        `/api/submissions/${goodId}/heuristic?phase=system`,
        "",
      );
      assert.equal(system.run.groups[0].completed, 3);
      assert.ok(!JSON.stringify(system).includes("boardReplay"));
      await request(`/api/problems/${id}`, admin, "PATCH", {
        visibility: "private",
      });
      await request(previewPath, bob, "POST", body, 404);
      await request(`/api/problems/${id}`, admin, "PATCH", {
        visibility: "public",
      });
      const runs = await db.heuristicRun.findMany({
        where: { problemId: id },
        include: { cases: true },
      });
      assert.ok(
        runs.every(
          (run) =>
            new Set(run.cases.map((c) => c.caseKey)).size === run.cases.length,
        ),
      );
      const fixturePath = process.env.GAME_TEST_FIXTURE ?? ".codex/game-board/http-fixture.json";
      mkdirSync(dirname(fixturePath), { recursive: true });
      writeFileSync(
        fixturePath,
        JSON.stringify(
          {
            problemId: id,
            courseId: course.id,
            contestId: contest.id,
            submissionId: goodId,
            latestId,
            score: expected,
            protocol: "turns",
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error(workerLog.slice(-8000));
      throw error;
    } finally {
      for (const worker of workers) worker.kill("SIGTERM");
      await db.$disconnect();
    }
  },
);

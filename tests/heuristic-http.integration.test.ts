import test from "node:test";
import assert from "node:assert/strict";
import { encode } from "next-auth/jwt";
import { Prisma, PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createHeuristicExample } from "../lib/heuristic-examples";
import { buildProblemPackageZip } from "../lib/problem-package";

test(
  "real HTTP and two workers: numeric scoring, frozen revision, private results, resume and final standings",
  { skip: !process.env.HEURISTIC_TEST_ORIGIN, timeout: 240000 },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname === "/ojp_heuristic_test",
      "Refusing non-test database",
    );
    assert.equal(process.env.HEURISTIC_TEST_ORIGIN, "http://127.0.0.1:3103");
    const origin = process.env.HEURISTIC_TEST_ORIGIN!;
    const prisma = new PrismaClient({ log: [] });
    const workers = [] as ReturnType<typeof spawn>[];
    const cookie = async (login: string) =>
      `authjs.session-token=${await encode({ secret: "heuristic-local-validation-only", salt: "authjs.session-token", token: { sub: login, oauthProvider: "github", oauthAccountId: login, oauthLogin: login, oauthName: login }, maxAge: 3600 })}`;
    const admin = await cookie("heuristic-test"),
      alice = await cookie("heuristic-alice"),
      bob = await cookie("heuristic-bob");
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
      predicate: (value: T) => boolean,
    ) {
      const deadline = Date.now() + 90000;
      let value: T | undefined;
      do {
        value = await read();
        if (predicate(value)) return value;
        await new Promise((r) => setTimeout(r, 300));
      } while (Date.now() < deadline);
      throw new Error("Timed out: " + JSON.stringify(value));
    }
    try {
      for (const auth of [admin, alice, bob])
        await request("/api/problems", auth);
      for (let i = 0; i < 2; i++)
        workers.push(
          spawn(
            process.execPath,
            ["--import", "tsx", "scripts/judge-worker.ts"],
            {
              env: {
                ...process.env,
                JUDGE_PROCESS_MODE: "worker",
                DYNO: `heuristic-integration-${i}`,
              },
              stdio: ["ignore", "pipe", "pipe"],
            },
          ),
        );
      let workerLog = "";
      for (const w of workers)
        for (const stream of [w.stdout, w.stderr])
          stream?.on("data", (data) => {
            workerLog += data.toString();
          });
      for (const kind of ["knapsack", "route"] as const) {
        const example = createHeuristicExample(kind, {
          provisional: 3,
          system: 5,
        });
        if (kind === "knapsack") {
          example.draft.heuristic!.evaluation = "relative";
          example.zip = buildProblemPackageZip(example.settings);
        }
        const slug = `heuristic-${kind}-${randomUUID().slice(0, 8)}`;
        const created = await request(
          "/api/problems",
          admin,
          "POST",
          { ...example.settings, slug },
          201,
        );
        const problem = created.problem;
        async function upload(zip: Buffer) {
          const form = new FormData();
          form.set("file", new Blob([new Uint8Array(zip)]), kind + ".zip");
          const response = await fetch(
            `${origin}/api/problems/${problem.id}/package`,
            { method: "POST", headers: { Cookie: admin }, body: form },
          );
          assert.equal(response.status, 201, await response.text());
        }
        await upload(example.zip);
        const endAt = new Date(Date.now() + 22000).toISOString();
        const { contest } = await request(
          "/api/contests",
          admin,
          "POST",
          {
            title: `Heuristic ${kind}`,
            slug,
            descriptionMarkdown: "integration",
            visibility: "unlisted",
            startAt: new Date(Date.now() - 1000).toISOString(),
            endAt,
            penaltyMinutes: 5,
            scoreboardVisibility: "full",
            rated: false,
            heuristic: { selection: kind === "route" ? "last" : "best" },
            problems: [
              { problemId: problem.id, label: "A", score: 1, orderIndex: 0 },
            ],
          },
          201,
        );
        const snapshot = await prisma.heuristicContest.findUniqueOrThrow({
          where: { contestId: contest.id },
        });
        const frozenRevision = (snapshot.revisions as Record<string, string>)[
          problem.id
        ];
        const ids: string[] = [];
        async function submit(auth: string, source: string) {
          const response = await request(
            "/api/submissions",
            auth,
            "POST",
            {
              problemId: problem.id,
              contestId: contest.id,
              language: "python",
              sourceCode: source,
            },
            201,
          );
          ids.push(response.submission.id);
          return response.submission.id;
        }
        await submit(alice, example.solutions.baseline);
        const optimalId = await submit(bob, example.solutions.optimal);
        await submit(admin, example.solutions.baseline);
        await submit(admin, example.solutions.optimal);
        await submit(admin, example.solutions.invalid);
        await until(
          () => request(`/api/submissions/${optimalId}/heuristic`, bob),
          (x) => x.run?.status === "completed",
        );
        const view = await request(
          `/api/submissions/${optimalId}/heuristic`,
          bob,
        );
        assert.equal(view.run.groups.length, 1);
        assert.equal(view.run.groups[0].completed, 3);
        assert.equal(view.run.groups[0].cases[0].name, "1");
        assert.equal(view.run.groups[0].cases[0].diagnostic, undefined);
        for (const id of ids)
          assert.equal(
            (
              await prisma.heuristicRun.findFirstOrThrow({
                where: { submissionId: id },
              })
            ).revisionId,
            frozenRevision,
          );
        const first = await prisma.heuristicRun.findFirstOrThrow({
          where: { submissionId: optimalId },
          include: { cases: true },
        });
        // Resume a durable run with one committed case, as after an interrupted worker.
        const resumed = await prisma.heuristicRun.create({
          data: {
            id: randomUUID(),
            submissionId: optimalId,
            problemId: problem.id,
            revisionId: frozenRevision,
            phase: "provisional",
            evaluationId: "resume-test",
            status: "queued",
            config: first.config as Prisma.InputJsonValue,
            sourceCode: first.sourceCode,
            language: first.language,
            cases: {
              create: {
                ...(Object.fromEntries(
                  Object.entries(first.cases[2]).filter(
                    ([key]) => key !== "runId",
                  ),
                ) as {
                  caseKey: string;
                  groupName: string;
                  caseName: string;
                  verdict: string;
                  rawScore: string;
                  timeMs: number;
                  memoryKb: number;
                }),
                diagnostic: "resume-sentinel",
              },
            },
          },
        });
        await until(
          () => prisma.heuristicRun.findUnique({ where: { id: resumed.id } }),
          (x) => x?.status === "completed",
        );
        assert.equal(
          (
            await prisma.heuristicCaseScore.findUniqueOrThrow({
              where: {
                runId_caseKey: {
                  runId: resumed.id,
                  caseKey: first.cases[2].caseKey,
                },
              },
            })
          ).diagnostic,
          "resume-sentinel",
        );
        assert.equal(
          await prisma.heuristicCaseScore.count({
            where: { runId: resumed.id },
          }),
          3,
        );
        assert.equal(
          await prisma.judgeJob.count({ where: { submissionId: { in: ids } } }),
          0,
          "Numeric submissions must never enter the legacy judge queue",
        );
        await until(
          () => request(`/api/submissions/${optimalId}`),
          (x) => x.submission.status === "accepted",
        );
        await request(`/api/submissions/${optimalId}/rejudge`, admin, "POST", {
          reason: "manual review",
          detail: "numeric revision test",
          revision: "original",
        });
        await until(
          () => request(`/api/submissions/${optimalId}/heuristic`),
          (x) => x.run?.id !== resumed.id && x.run?.status === "completed",
        );
        const changed = createHeuristicExample(kind, {
          provisional: 3,
          system: 5,
        });
        changed.settings.draft.checkerSourceCode =
          'print(\'{"version":1,"valid":true,"score":"0"}\')\n';
        await upload(buildProblemPackageZip(changed.settings));
        await request(`/api/problems/${problem.id}`, admin, "PATCH", {
          statementMarkdown: "CURRENT-EDIT-NOT-CONTEST",
        });
        await request(`/api/contests/${contest.id}`, admin, "PATCH", {
          descriptionMarkdown: "Frozen settings remain editable",
        });
        const frozenPage = await fetch(
          `${origin}/problems/${problem.id}?contestId=${contest.id}`,
          { headers: { Cookie: bob } },
        );
        assert.equal(frozenPage.status, 200);
        assert.ok(
          !(await frozenPage.text()).includes("CURRENT-EDIT-NOT-CONTEST"),
        );
        await request(
          `/api/submissions/${optimalId}/heuristic?phase=system`,
          bob,
          "GET",
          undefined,
          404,
        );
        const frozen = await submit(admin, example.solutions.optimal);
        await until(
          () => request(`/api/submissions/${frozen}/heuristic`),
          (x) => x.run?.status === "completed",
        );
        assert.equal(
          (
            await prisma.heuristicRun.findFirstOrThrow({
              where: { submissionId: frozen },
            })
          ).revisionId,
          frozenRevision,
        );
        await request(
          `/api/contests/${contest.id}/heuristic/finalize`,
          alice,
          "POST",
          undefined,
          403,
        );
        await new Promise((r) =>
          setTimeout(r, Math.max(0, Date.parse(endAt) - Date.now() + 1200)),
        );
        await until(
          () => request(`/api/contests/${contest.id}/scoreboard`),
          (x) => x.status === "ended",
        );
        await request(
          `/api/contests/${contest.id}/heuristic/finalize`,
          admin,
          "POST",
        );
        await request(
          `/api/contests/${contest.id}/heuristic/finalize`,
          admin,
          "POST",
        );
        const board = await until(
          () => request(`/api/contests/${contest.id}/scoreboard`),
          (x) => x.heuristic?.state === "final",
        );
        assert.ok(
          board.rows.some(
            (r: { heuristicScore: string | null }) => r.heuristicScore !== null,
          ),
        );
        const final = await prisma.heuristicContest.findUniqueOrThrow({
          where: { contestId: contest.id },
        });
        const system = await prisma.heuristicRun.findMany({
          where: { evaluationId: final.evaluationId! },
          include: { cases: true },
        });
        assert.equal(
          system.length,
          (final.finalSubmissionIds as string[]).length,
        );
        assert.ok(
          system.every((r) => r.status === "completed" && r.cases.length === 5),
        );
        assert.ok(
          system.every((r) => r.cases.every((c) => c.groupName === "system")),
        );
        const finalView = await request(
          `/api/submissions/${optimalId}/heuristic?phase=system`,
          bob,
        );
        assert.equal(finalView.run.phase, "system");
        assert.equal(finalView.run.groups[0].completed, 5);
        assert.ok(
          !/prisma:error|fatal error|tick failed/.test(workerLog),
          workerLog.slice(-3000),
        );
      }
      const large = createHeuristicExample("knapsack", {
        provisional: 1,
        system: 1,
      });
      const exact = "999999999999999999999999.123456789012";
      large.draft.checkerLanguage = "javascript";
      large.draft.checkerSourceCode = `console.log(JSON.stringify({version:1,valid:true,score:${JSON.stringify(exact)}}))`;
      const huge = await request(
        "/api/problems",
        admin,
        "POST",
        { ...large.settings, slug: `decimal-${randomUUID().slice(0, 8)}` },
        201,
      );
      const form = new FormData();
      form.set(
        "file",
        new Blob([new Uint8Array(buildProblemPackageZip(large.settings))]),
        "decimal.zip",
      );
      const upload = await fetch(
        `${origin}/api/problems/${huge.problem.id}/package`,
        { method: "POST", headers: { Cookie: admin }, body: form },
      );
      assert.equal(upload.status, 201);
      const created = await request(
        "/api/submissions",
        admin,
        "POST",
        {
          problemId: huge.problem.id,
          language: "javascript",
          sourceCode: "console.log(0)",
        },
        201,
      );
      const hugeView = await until(
        () => request(`/api/submissions/${created.submission.id}/heuristic`),
        (x) => x.run?.status === "completed",
      );
      assert.equal(hugeView.run.score, exact);
      assert.equal(hugeView.run.groups[0].cases[0].score, exact);
    } finally {
      for (const w of workers) w.kill();
      await Promise.all(
        workers.map((w) =>
          w.exitCode === null
            ? new Promise((r) => w.once("exit", r))
            : undefined,
        ),
      );
      await prisma.$disconnect();
    }
  },
);

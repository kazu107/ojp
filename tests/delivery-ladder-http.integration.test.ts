import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import { deliveryTestBots as bots } from "./delivery-bots";
import type { ArenaEntry } from "../lib/delivery-evaluation";

const origin = process.env.DELIVERY_TEST_ORIGIN;
test("HTTP: registered bots continue playing without weekly evaluations, and old replays stay available", {
  skip: !origin, timeout: 150000,
}, async () => {
  assert.equal(origin, "http://127.0.0.1:3118");
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/ojp_delivery_test");
  assert.equal(process.env.JUDGE_SANDBOX, "bubblewrap");
  assert.equal(process.env.DELIVERY_ARENA_MODE, "ladder");
  const db = new PrismaClient();
  const workers: ReturnType<typeof spawn>[] = [];
  let workerLog = "";
  const cookie = async (login: string) => `authjs.session-token=${await encode({
    secret: "delivery-local-validation-only", salt: "authjs.session-token", maxAge: 1200,
    token: { sub: login, oauthProvider: "github", oauthAccountId: login, oauthLogin: login, oauthName: login },
  })}; ojp_locale=en`;
  const [admin, a, b, c] = await Promise.all(["delivery-admin", "ladder-a", "ladder-b", "ladder-c"].map(cookie));
  async function page(path: string, auth = "ojp_locale=en", expected = 200) {
    const response = await fetch(origin + path, { headers: { Cookie: auth }, signal: AbortSignal.timeout(12000) });
    assert.equal(response.status, expected, path);
    return response.text();
  }
  async function action(auth: string, body: object, status: number) {
    const response = await fetch(origin + "/api/games/delivery", {
      method: "POST", headers: { Cookie: auth, Origin: origin!, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
    });
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  }
  async function until<T>(fn: () => Promise<T>, done: (value: T) => boolean, ms = 65000) {
    for (const deadline = Date.now() + ms; Date.now() < deadline; await pause(250)) {
      const value = await fn();
      if (done(value)) return value;
      assert.ok(workers.every(worker => worker.exitCode === null));
    }
    throw new Error("Timed out waiting for a continuous evaluation");
  }
  try {
    await db.deliveryMatch.deleteMany({ where: { evaluation: { kind: { startsWith: "ladder-" } } } });
    await db.deliveryEvaluation.deleteMany({ where: { kind: { startsWith: "ladder-" } } });
    await db.deliveryLadderEntry.deleteMany();
    await db.deliveryLadderClock.deleteMany();
    await db.deliveryBotVersion.updateMany({ where: { validUntil: null }, data: { validUntil: new Date() } });
    const weekBefore = await db.deliveryEvaluation.count({ where: { kind: "weekly" } });
    let archived = await db.deliveryEvaluation.findFirst({ where: { kind: "manual", status: "published" },
      include: { matches: { take: 1, select: { id: true } } } });
    if (!archived) {
      const id = randomUUID(), now = new Date();
      archived = await db.deliveryEvaluation.create({ data: {
        id, key: "archive:" + id, kind: "manual", status: "published", cutoff: now,
        publishedAt: now, entries: [], standings: [],
      }, include: { matches: { take: 1, select: { id: true } } } });
    }
    assert.match(await page("/games/delivery"), /Continuous standings/);
    assert.match(await page("/games/delivery", "ojp_locale=ja"), /常設順位表/);
    await action(admin, { action: "start" }, 410);
    await action(a, { action: "start" }, 403);
    const va = await action(a, { action: "register", name: "Ladder Greedy", ...bots.greedy }, 201);
    const vb = await action(b, { action: "register", name: "Ladder Wait", ...bots.wait }, 201);
    await action(c, { action: "register", name: "Ladder Patrol", ...bots.patrol }, 201);
    assert.match(await page("/games/delivery", a), /Placement: 0\/6 sets/);
    for (let i = 0; i < 2; i++) {
      const worker = spawn(process.execPath, ["--import", "tsx", "scripts/judge-worker.ts"], {
        env: { ...process.env, JUDGE_PROCESS_MODE: "worker", DYNO: "ladder-http-" + i },
        stdio: ["ignore", "pipe", "pipe"],
      });
      workers.push(worker);
      for (const stream of [worker.stdout, worker.stderr]) stream?.on("data", data => {
        workerLog = (workerLog + data.toString()).slice(-8000);
      });
    }
    await until(() => db.deliveryLadderEntry.count({ where: { state: "rated" } }), count => count === 3);
    const standings = await page("/games/delivery");
    assert.match(standings, /3 registered bots/);
    assert.match(standings, /Ladder Greedy/);
    assert.match(standings, /Ladder Wait/);
    assert.doesNotMatch(standings, /from collections import deque/);
    const published = await until(() => db.deliveryEvaluation.findMany({
      where: { kind: "ladder-rated", status: "published" }, take: 2, orderBy: { publishedAt: "asc" },
      include: { matches: { orderBy: { ordinal: "asc" }, select: { id: true, status: true, flipped: true, attempts: true } } },
    }), rows => rows.length === 2);
    for (const pair of published) {
      assert.equal((pair.entries as ArenaEntry[]).length, 2);
      assert.deepEqual(pair.matches.map(m => [m.flipped, m.status, m.attempts]),
        [[false, "completed", 1], [true, "completed", 1]]);
      assert.match(await page("/games/delivery/matches/" + pair.matches[0].id), /Turn history/);
    }
    assert.equal(await db.deliveryEvaluation.count({ where: { kind: "weekly" } }), weekBefore);
    const next = await action(b, { action: "register", name: "Ladder New Wait", ...bots.wait }, 201);
    assert.notEqual(next.id, vb.id);
    assert.match(await page("/games/delivery", b), /Previous version/);
    assert.equal(await db.deliveryLadderEntry.count({ where: { activeVersionId: next.id, rankedVersionId: vb.id, state: "pending" } }), 1);
    await until(() => db.deliveryLadderEntry.findFirst({ where: { activeVersionId: next.id },
      select: { rankedVersionId: true, state: true } }), row => row?.state === "rated" && row.rankedVersionId === next.id);
    assert.match(await page("/games/delivery"), /Ladder New Wait/);
    await action(c, { action: "withdraw" }, 200);
    assert.equal(await db.deliveryLadderEntry.count({ where: { state: "withdrawn" } }), 1);
    assert.equal(await db.deliveryLadderEntry.count({ where: { activeVersionId: va.id, state: "rated" } }), 1);
    const archive = await page("/games/delivery?view=official&evaluation=" + archived.id, admin);
    assert.match(archive, /Past evaluations/);
    assert.doesNotMatch(archive, /Start manual evaluation|Weekly cutoff:/);
    if (archived.matches[0]) assert.match(await page("/games/delivery/matches/" + archived.matches[0].id), /Turn history/);
  } catch (error) {
    if (workerLog) console.error(workerLog);
    throw error;
  } finally {
    for (const worker of workers) worker.kill("SIGTERM");
    await db.$disconnect();
  }
});

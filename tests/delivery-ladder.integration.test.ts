import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { deliveryTestBots } from "./delivery-bots";
import type { ArenaEntry } from "../lib/delivery-evaluation";
import type { LadderScore } from "../lib/delivery-ladder";

const url = process.env.DELIVERY_TEST_DATABASE_URL;
async function clear(db: PrismaClient) {
  await db.deliveryMatch.deleteMany();
  await db.deliveryEvaluation.deleteMany();
  await db.deliveryLadderEntry.deleteMany();
  await db.deliveryLadderClock.deleteMany();
  await db.deliveryBotVersion.deleteMany();
}

test("unbounded enrollment, two real matches, rolling fairness, version replacement and archival", {
  skip: !url, timeout: 45000,
}, async () => {
  assert.ok(url);
  const dbUrl = new URL(url);
  assert.equal(dbUrl.hostname, "127.0.0.1");
  assert.equal(dbUrl.pathname, "/ojp_delivery_test");
  Object.assign(process.env, { DATABASE_URL: url, NODE_ENV: "test", OJP_GAME_UNSAFE_LOCAL_TEST: "1",
    DELIVERY_ARENA_ENABLED: "1", DELIVERY_ARENA_MODE: "ladder", DELIVERY_MATCH_CONCURRENCY: "2",
    DELIVERY_WEEKLY_ENABLED: "1", DELIVERY_LIVE_ENABLED: "1" });
  const { prisma: db } = await import("../lib/db/prisma");
  const arena = await import("../lib/delivery-store");
  const ladder = await import("../lib/delivery-ladder-store");
  const ready = new Date("2026-01-01T00:00:00Z");
  let now = new Date();
  const game: LadderScore = { winner: null, outcome: "score", faults: [null, null] };
  async function finish(id: string, games: LadderScore[] | null = [game, game]) {
    await db.$transaction(async tx => {
      const e = await tx.deliveryEvaluation.findUniqueOrThrow({ where: { id } });
      if (e.status !== "active") return;
      assert.ok(e.kind === "ladder-placement" || e.kind === "ladder-rated");
      await tx.deliveryMatch.updateMany({ where: { evaluationId: id }, data: { status: games ? "completed" : "failed" } });
      await ladder.settleLadderPair(tx, id, e.kind, e.entries as ArenaEntry[], games, now);
    });
  }
  async function schedule() {
    const id = await db.$transaction(tx => ladder.scheduleLadderPair(tx, now));
    assert.ok(id);
    const e = await db.deliveryEvaluation.findUniqueOrThrow({ where: { id } });
    return { id, mode: e.kind, seats: e.entries as ArenaEntry[] };
  }
  const setup = async (id: number) => ({
    userId: "continuous-" + id,
    ...(await arena.registerDeliveryBot("continuous-" + id, "Continuous " + id, deliveryTestBots.wait)),
  });
  try {
    await clear(db);
    for (let i = 0; i < 96; i++) await setup(i);
    assert.equal(await db.deliveryLadderEntry.count({ where: { state: "pending" } }), 96);
    await assert.rejects(arena.startDeliveryEvaluation("weekly"), error => (error as { status: number }).status === 410);
    await db.deliveryLadderEntry.updateMany({ data: { availableAt: ready } });
    const initial = await schedule();
    assert.equal(await db.deliveryMatch.count(), 2);
    const jobs = await Promise.all(Array.from({ length: 4 }, () => arena.startDeliveryWork()));
    await Promise.all(jobs.filter(job => job !== null).map(job => job.done));
    const matches = await db.deliveryMatch.findMany({ where: { evaluationId: initial.id }, orderBy: { ordinal: "asc" } });
    assert.equal(matches.length, 2);
    assert.deepEqual(matches.map(m => [m.flipped, m.attempts, m.status]), [[false, 1, "completed"], [true, 1, "completed"]]);
    assert.equal(matches[0].seed, matches[1].seed);
    assert.equal((await db.deliveryLadderEntry.findUniqueOrThrow({ where: { userId: initial.seats[0].userId } })).sets, 1);
    assert.ok(await arena.readDeliveryMatch(matches[0].id));
    const tied = await db.deliveryLadderEntry.findMany({ orderBy: { userId: "asc" }, take: 33 });
    for (const row of tied) await db.deliveryLadderEntry.update({ where: { userId: row.userId },
      data: { rankedVersionId: row.activeVersionId, rankedName: row.activeName, state: "rated" } });
    const page2 = await ladder.deliveryLadderOverview(undefined, 2);
    assert.equal(page2.standings.length, 3);
    assert.ok(page2.standings.every(row => row.rank === 1));

    // Virtual time makes tests of many scheduling decisions fast. All real claims above used live worker code.
    await clear(db);
    for (let i = 0; i < 5; i++) await setup(i);
    await db.deliveryLadderEntry.updateMany({ data: { state: "rated", dueAt: ready, availableAt: ready,
      sets: 6, rankedSets: 6 } });
    const liveRows = await db.deliveryLadderEntry.findMany();
    for (const row of liveRows) await db.deliveryLadderEntry.update({ where: { userId: row.userId },
      data: { rankedVersionId: row.activeVersionId, rankedName: row.activeName } });
    now = new Date();
    const involvement = new Set<string>(), firsts = new Set<string>();
    for (let i = 0; i < 10; i++) {
      now = new Date(now.getTime() + 20000);
      const pair = await schedule();
      assert.equal(pair.mode, "ladder-rated");
      assert.notEqual(pair.seats[0].userId, pair.seats[1].userId);
      pair.seats.forEach(seat => involvement.add(seat.userId));
      firsts.add(pair.seats[0].userId);
      await finish(pair.id);
    }
    assert.equal(involvement.size, 5);
    const spread = (await db.deliveryLadderEntry.findMany()).map(row => row.sets);
    assert.ok(Math.max(...spread) - Math.min(...spread) <= 2, String(spread));
    assert.ok(firsts.size >= 3);
    const before = await db.deliveryLadderEntry.findUniqueOrThrow({ where: { userId: "continuous-0" } });
    await arena.registerDeliveryBot("continuous-0", "Draft 1", deliveryTestBots.wait);
    now = new Date(now.getTime() + 20000);
    const retiring = await schedule();
    assert.equal(retiring.mode, "ladder-placement");
    const latest = await arena.registerDeliveryBot("continuous-0", "Draft 2", deliveryTestBots.wait);
    assert.equal((await db.deliveryEvaluation.findUniqueOrThrow({ where: { id: retiring.id } })).status, "superseded");
    assert.equal(await db.deliveryMatch.count({ where: { evaluationId: retiring.id, status: "cancelled" } }), 2);
    await finish(retiring.id);
    const pending = await db.deliveryLadderEntry.findUniqueOrThrow({ where: { userId: "continuous-0" } });
    assert.equal(pending.activeVersionId, latest.id);
    assert.equal(pending.rankedVersionId, before.rankedVersionId);
    assert.equal(pending.rankedName, before.rankedName);
    assert.equal(pending.rankedRating, before.rankedRating);
    assert.equal(pending.sets, 0);

    for (let i = 0; i < 9; i++) {
      now = new Date(now.getTime() + 20000);
      const pair = await schedule();
      await finish(pair.id);
    }
    const settled = await db.deliveryLadderEntry.findUniqueOrThrow({ where: { userId: "continuous-0" } });
    assert.equal(settled.state, "rated");
    assert.equal(settled.rankedName, "Draft 2");
    assert.equal(settled.rankedVersionId, latest.id);
    const evaluated = await db.deliveryEvaluation.findMany({ where: { kind: "ladder-placement", status: "published" } });
    assert.equal(evaluated.filter(e => (e.entries as ArenaEntry[])[0].versionId === latest.id).length, 6);
    now = new Date(now.getTime() + 20000);
    const failed = await schedule();
    const prior = await db.deliveryLadderEntry.findMany({
      where: { userId: { in: failed.seats.map(e => e.userId) } }, orderBy: { userId: "asc" },
    });
    await finish(failed.id, null);
    const cooled = await db.deliveryLadderEntry.findMany({
      where: { userId: { in: failed.seats.map(e => e.userId) } }, orderBy: { userId: "asc" },
    });
    assert.deepEqual(cooled.map(e => e.rating), prior.map(e => e.rating));
    assert.ok(cooled.every(e => e.availableAt > now));
    await arena.withdrawDeliveryBot("continuous-0");
    assert.equal((await ladder.deliveryLadderOverview()).count, 4);
  } finally {
    try { await clear(db); } finally { await db.$disconnect(); }
  }
});

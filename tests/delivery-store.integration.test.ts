import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { deliveryLiveKey } from "../lib/delivery-evaluation";

const url = process.env.DELIVERY_TEST_DATABASE_URL;
const waitBot = {
  language: "javascript",
  sourceCode: `const lines = require("node:readline").createInterface({input: process.stdin});
let remaining = 0;
lines.on("line", s => {
  if (!remaining) {
    if (s === "END") { lines.close(); return; }
    const f = s.split(" ").map(Number);
    remaining = f[2] + f[11];
  } else if (!--remaining) console.log("WAIT");
});`,
} as const;

test("versioned enrollment, concurrent worker fencing, complete publication, and replay privacy", { skip: !url, timeout: 90000 }, async () => {
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(parsed.pathname, "/ojp_delivery_test");
  process.env.DATABASE_URL = url;
  process.env.DELIVERY_ARENA_ENABLED = "1";
  process.env.DELIVERY_LIVE_ENABLED = "0";
  process.env.DELIVERY_WEEKLY_ENABLED = "0";
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.OJP_GAME_UNSAFE_LOCAL_TEST = "1";
  const { prisma } = await import("../lib/db/prisma");
  const arena = await import("../lib/delivery-store");
  try {
    await prisma.deliveryMatch.deleteMany();
    await prisma.deliveryEvaluation.deleteMany();
    await prisma.deliveryBotVersion.deleteMany();
    const a = await arena.registerDeliveryBot("test-a", "Original", waitBot);
    const b = await arena.registerDeliveryBot("test-b", "Second", waitBot);
    const trial = await arena.enqueueDeliveryTrial("test-a", waitBot);
    assert.equal(await arena.readDeliveryMatch(trial.id, "test-b"), null);
    assert.equal(await arena.readDeliveryMatch(trial.id), null);
    assert.equal((await arena.readDeliveryMatch(trial.id, "test-a"))?.status, "queued");
    await assert.rejects(arena.enqueueDeliveryTrial("test-a", waitBot), /already queued/);
    const raced = await Promise.all(Array.from({ length: 4 }, () => arena.workOneDeliveryMatch()));
    assert.equal(raced.filter(Boolean).length, 1);
    const privateReplay = await arena.readDeliveryMatch(trial.id, "test-a");
    assert.equal(privateReplay?.result?.frames.length, 101);
    const storedTrial = await prisma.deliveryMatch.findUniqueOrThrow({ where: { id: trial.id } });
    assert.equal(storedTrial.attempts, 1);
    assert.equal(storedTrial.trialSource, null);

    const evaluation = await arena.startDeliveryEvaluation("manual");
    assert.ok(evaluation);
    const matches = await prisma.deliveryMatch.findMany({ where: { evaluationId: evaluation.id }, orderBy: { ordinal: "asc" } });
    assert.equal(matches.length, 6);
    assert.ok(matches.every(m => m.versionA === a.id && m.versionB === b.id));
    assert.equal(await arena.readDeliveryMatch(matches[0].id), null);
    await arena.registerDeliveryBot("test-a", "Replacement", { ...waitBot, sourceCode: "process.exit(1);" });
    await arena.withdrawDeliveryBot("test-b");
    for (let i = 0; i < 5; i++) assert.equal(await arena.workOneDeliveryMatch(), true);
    assert.equal(await arena.readDeliveryMatch(matches[0].id), null);
    assert.equal((await arena.deliveryOverview()).standings, undefined);
    assert.equal(await arena.workOneDeliveryMatch(), true);
    const overview = await arena.deliveryOverview("test-a");
    assert.deepEqual(overview.standings?.map(r => [r.name, r.games, r.points, r.rank]), [
      ["Original", 6, 6, 1], ["Second", 6, 6, 1],
    ]);
    assert.equal(overview.bot?.name, "Replacement");
    assert.equal((await arena.deliveryOverview()).bot, null);
    assert.equal(await arena.readDeliveryMatch(trial.id), null);
    const replay = await arena.readDeliveryMatch(matches[0].id);
    assert.deepEqual(replay?.names, ["Original", "Second"]);
    assert.deepEqual(replay?.result?.totals, [0, 0]);
    assert.equal(await prisma.deliveryMatch.count({ where: { evaluationId: evaluation.id, attempts: 1, status: "completed" } }), 6);

    const monday = new Date("2026-11-22T18:00:00.000Z");
    const before = new Date(monday.getTime() - 5000);
    const after = new Date(monday.getTime() + 5000);
    await prisma.deliveryBotVersion.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { createdAt: before, validUntil: after } });
    await prisma.deliveryBotVersion.updateMany({ where: { name: "Replacement" }, data: { createdAt: after } });
    const weekly = await arena.startDeliveryEvaluation("weekly", new Date(monday.getTime() + 10000));
    assert.ok(weekly);
    assert.equal(await arena.startDeliveryEvaluation("weekly", new Date(monday.getTime() + 10000)), null);
    assert.equal(await prisma.deliveryMatch.count({ where: { evaluationId: weekly.id, versionA: a.id, versionB: b.id } }), 6);
    const interrupted = await prisma.deliveryMatch.findFirstOrThrow({ where: { evaluationId: weekly.id, ordinal: 0 } });
    await prisma.deliveryMatch.update({ where: { id: interrupted.id }, data: {
      status: "running", attempts: 1, token: "stale-test-lease", leaseUntil: new Date(Date.now() - 1000),
    } });
    assert.equal(await arena.workOneDeliveryMatch(), true);
    const recovered = await prisma.deliveryMatch.findUniqueOrThrow({ where: { id: interrupted.id } });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.attempts, 2);
    assert.equal(recovered.token, null);
  } finally {
    try {
      await prisma.deliveryMatch.deleteMany();
      await prisma.deliveryEvaluation.deleteMany();
      await prisma.deliveryBotVersion.deleteMany();
    } finally { await prisma.$disconnect(); }
  }
});

test("live version changes respect a current lease, then supersede stale work", { skip: !url, timeout: 40000 }, async () => {
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(parsed.pathname, "/ojp_delivery_test");
  process.env.DATABASE_URL = url;
  process.env.DELIVERY_ARENA_ENABLED = "1";
  process.env.DELIVERY_WEEKLY_ENABLED = "0";
  process.env.DELIVERY_LIVE_ENABLED = "1";
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.OJP_GAME_UNSAFE_LOCAL_TEST = "1";
  const { prisma } = await import("../lib/db/prisma");
  const arena = await import("../lib/delivery-store");
  const enroll = async (userId: string) => {
    const saved = await arena.registerDeliveryBot(userId, userId, waitBot);
    return { userId, name: saved.name, versionId: saved.id };
  };
  try {
    const a = await enroll("live-a");
    assert.equal(await arena.workOneDeliveryMatch(), false);
    await pause(2100);
    const b = await enroll("live-b");
    assert.equal(await arena.workOneDeliveryMatch(), true);
    const original = await prisma.deliveryEvaluation.findUniqueOrThrow({ where: { key: deliveryLiveKey([a, b]) } });
    assert.equal(original.status, "active");
    const pending = await prisma.deliveryMatch.findFirstOrThrow({ where: { evaluationId: original.id, status: "queued" } });
    await prisma.deliveryMatch.update({ where: { id: pending.id }, data: {
      status: "running", token: "test-in-flight", leaseUntil: new Date(Date.now() + 30000), attempts: 1,
    } });
    const c = await enroll("live-c");
    await pause(2100);
    assert.equal(await arena.workOneDeliveryMatch(), false);
    assert.equal(await prisma.deliveryEvaluation.findUnique({ where: { key: deliveryLiveKey([a, b, c]) } }), null);
    await prisma.deliveryMatch.update({ where: { id: pending.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    await pause(2100);
    assert.equal(await arena.workOneDeliveryMatch(), true);
    assert.equal((await prisma.deliveryEvaluation.findUnique({ where: { id: original.id } }))?.status, "superseded");
    assert.equal((await prisma.deliveryMatch.findUnique({ where: { id: pending.id } }))?.status, "cancelled");
    await arena.withdrawDeliveryBot(c.userId);
    await pause(2100);
    assert.equal(await arena.workOneDeliveryMatch(), true);
    assert.equal((await prisma.deliveryEvaluation.findUnique({ where: { id: original.id } }))?.status, "published");
    assert.equal(await prisma.deliveryMatch.count({ where: { evaluationId: original.id, status: "completed", attempts: 1 } }), 2);
  } finally {
    try {
      await prisma.deliveryMatch.deleteMany();
      await prisma.deliveryEvaluation.deleteMany();
      await prisma.deliveryBotVersion.deleteMany();
    } finally { await prisma.$disconnect(); }
  }
});

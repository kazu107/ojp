import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DELIVERY_TURNS, DELIVERY_OFFICIAL_MAPS, DeliveryGame, deliveryBoardReplay, deliveryMapForRules, deliveryReward, parseDeliveryAction,
  standardDeliveryAction, type DeliveryAction, type Order,
} from "../lib/delivery-game";
import { liveMatchCount, planDeliveryMatches, rankDelivery, weeklyDeliveryCutoff } from "../lib/delivery-evaluation";

const wait: DeliveryAction = { kind: "WAIT" };
const order: Order = { id: 1, from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, opens: 1, deadline: 3, base: 40, size: 2 };
function fixture(orders = [order], flipped = false) {
  return new DeliveryGame(1, flipped, {
    board: ["###############", ...Array<string>(13).fill("#.............#"), "###############"],
    orders, starts: [order.from, order.from], priority: 0,
  });
}

test("contested pickups have one owner, alternate priority, and mirror on replay", () => {
  const pick: DeliveryAction = { kind: "PICKUP", id: 1 };
  for (const [flipped, delay, winner] of [[false, false, 0], [false, true, 1], [true, false, 1]] as const) {
    const game = fixture(undefined, flipped);
    if (delay) game.step([wait, wait]);
    const observations = [game.observe(0), game.observe(1)];
    assert.ok(observations.every(text => text.trim().split("\n").at(-1)?.endsWith(" -1")));
    game.step([pick, pick]);
    assert.equal(game.orders[0].owner, winner);
    assert.deepEqual(game.frames.at(-1)?.events, [{ kind: "contested", seat: winner, orderId: 1 }]);
    assert.deepEqual([game.load(0), game.load(1)], winner ? [0, 2] : [2, 0]);
  }
});

test("capacity, ownership, walls, and inclusive deadlines are enforced", () => {
  const game = fixture([order, { ...order, id: 2, size: 1, deadline: 4 }]);
  game.step([{ kind: "PICKUP", id: 1 }, { kind: "UP" }]);
  assert.equal(game.frames[1].actions[1], "WAIT");
  game.step([{ kind: "PICKUP", id: 2 }, { kind: "DELIVER", id: 1 }]);
  assert.deepEqual(game.frames[2].actions, ["WAIT", "WAIT"]);
  game.step([wait, wait]);
  assert.deepEqual(game.result().totals, [-40, 0]);
  assert.equal(game.load(0), 0);
  assert.deepEqual(game.frames.at(-1)?.events, [{ kind: "expired", seat: 0, orderId: 1, penalty: 40 }]);

  const beforeDeadline = fixture();
  beforeDeadline.step([{ kind: "PICKUP", id: 1 }, wait]);
  beforeDeadline.step([{ kind: "RIGHT" }, { kind: "RIGHT" }]);
  beforeDeadline.step([{ kind: "DELIVER", id: 1 }, { kind: "DELIVER", id: 1 }]);
  assert.deepEqual(beforeDeadline.result().totals, [40, 0]);
  assert.equal(beforeDeadline.couriers[0].penalty, 0);
  assert.deepEqual(beforeDeadline.frames.at(-1)?.events, [{ kind: "delivered", seat: 0, orderId: 1, base: 40, bonus: 0 }]);
  assert.equal(deliveryReward(40, 20, 1), 60);
  assert.equal(deliveryReward(40, 5, 2), 46);
});

test("official maps vary delivery distance and keep identical mirrored order sets", () => {
  for (const map of DELIVERY_OFFICIAL_MAPS) for (let seed = 0; seed < 40; seed++) {
    const game = new DeliveryGame(seed, false, undefined, map);
    const mirror = new DeliveryGame(seed, true, undefined, map);
    const result = game.result();
    assert.equal(deliveryMapForRules(result.rules), map);
    assert.deepEqual(mirror.result().orders, result.orders);
    assert.equal(mirror.firstPriority, 1 - game.firstPriority);
    for (const o of result.orders) {
      const distance = (o.base - 35 - (o.size - 1) * 20) / 3;
      assert.ok(distance >= 4 && o.opens + distance + 1 <= o.deadline);
      if (map === "short") assert.ok(distance <= 9);
      if (map === "long") assert.ok(distance >= 12);
      if (map === "bottleneck") assert.notEqual(o.from.x < 7, o.to.x < 7);
    }
    if (map === "bottleneck") {
      assert.equal(result.board.filter(row => row[7] !== "#").length, 1);
    }
  }
});

test("large live schedules are balanced and updating one version changes only sixteen matches", () => {
  for (const size of [16, 32, 64]) {
    const entries = Array.from({ length: size }, (_, n) => ({ userId: "user-" + n, versionId: "v" + n, name: "Bot" + n }));
    const options = { sampled: size >= 32 };
    const fixtures = planDeliveryMatches(entries, [10], options);
    assert.equal(fixtures.length, liveMatchCount(size));
    assert.equal(fixtures.length, size === 16 ? 240 : size * 8);
    const keys = new Set(fixtures.map(f => f.versionA + ":" + f.versionB + ":" + f.flipped));
    assert.equal(keys.size, fixtures.length);
    for (const bot of entries) {
      const games = fixtures.filter(f => f.versionA === bot.versionId || f.versionB === bot.versionId);
      assert.equal(games.length, 2 * (size === 16 ? 15 : 8));
      for (const f of games) assert.ok(keys.has(f.versionA + ":" + f.versionB + ":" + !f.flipped));
    }
    const updated = entries.map((e, i) => i === 0 ? { ...e, versionId: "replacement" } : e);
    assert.equal(planDeliveryMatches(updated, [10], options).filter(f => !keys.has(f.versionA + ":" + f.versionB + ":" + f.flipped)).length,
      2 * (size === 16 ? 15 : 8));
    const official = planDeliveryMatches(entries, [1, 2, 3], { official: true });
    assert.equal(official.length, 3 * size * (size - 1));
    assert.deepEqual(new Set(official.map(f => deliveryMapForRules(f.rules))), new Set(DELIVERY_OFFICIAL_MAPS));
  }
});

test("matching seeds replay deterministically with swapped starts and 100 turns", () => {
  const play = (flipped: boolean) => {
    const game = new DeliveryGame(11, flipped);
    while (!game.done) game.step([standardDeliveryAction(game, 0), standardDeliveryAction(game, 1)]);
    return game.result();
  };
  const result = play(false), mirror = play(true);
  assert.deepEqual(result, play(false));
  assert.deepEqual(result.board, mirror.board);
  assert.deepEqual(result.orders, mirror.orders);
  assert.deepEqual(result.totals, [...mirror.totals].reverse());
  assert.equal(result.frames.length, DELIVERY_TURNS + 1);
  assert.ok(result.totals.every(score => score > 0));
  assert.equal(deliveryBoardReplay(result).frames.at(-1)?.turn, DELIVERY_TURNS);
  assert.notDeepEqual(new DeliveryGame(12).board, result.board);
  for (const input of ["UPPER", "WAIT WAIT", "PICKUP 00", "DELIVER 1000", "PICKUP -1"]) {
    assert.equal(parseDeliveryAction(input), null);
  }
  assert.deepEqual(parseDeliveryAction("DELIVER 5"), { kind: "DELIVER", id: 5 });
});

test("weekly cutoff is Monday 03:00 JST, including the exact instant", () => {
  const at = new Date("2026-11-22T18:00:00.000Z");
  const result = weeklyDeliveryCutoff(at);
  assert.equal(result.key, "weekly:2026-11-23");
  assert.equal(result.cutoff.toISOString(), at.toISOString());
  assert.equal(weeklyDeliveryCutoff(new Date(at.getTime() - 1)).key, "weekly:2026-11-16");
  assert.equal(weeklyDeliveryCutoff(new Date(at.getTime() + 1)).key, result.key);
});

test("eight bots make 168 games; standings use 3/1/0 with shared ranks", () => {
  const entries = Array.from({ length: 8 }, (_, id) => ({ userId: "user-" + id, versionId: "v" + id, name: "Bot " + id }));
  const schedule = planDeliveryMatches(entries, [1, 2, 3]);
  assert.equal(schedule.length, 168);
  assert.equal(new Set(schedule.map(g => JSON.stringify([g.versionA, g.versionB, g.seed, g.flipped]))).size, 168);
  assert.equal(schedule.filter(g => g.versionA === "v0").length, 42);
  const rows = rankDelivery(entries.slice(0, 3), [
    { versionA: "v0", versionB: "v1", result: { winner: 0, outcome: "score", totals: [2, 1] } },
    { versionA: "v0", versionB: "v2", result: { winner: null, outcome: "score", totals: [1, 1] } },
    { versionA: "v1", versionB: "v2", result: { winner: 0, outcome: "forfeit", totals: [0, 9] } },
    { versionA: "v1", versionB: "v2", result: { winner: null, outcome: "double_forfeit", totals: [0, 0] } },
    { versionA: "v1", versionB: "v2", result: { winner: 1, outcome: "score", totals: [1, 2] } },
    { versionA: "v1", versionB: "v2", result: { winner: null, outcome: "score", totals: [0, 0] } },
  ]);
  assert.deepEqual(rows.map(r => [r.points, r.rank, r.score]), [[5, 1, 12], [4, 2, 3], [4, 2, 2]]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseLadderOpponent, estimateDeliverySkill, ladderOpponentTarget, ladderPlacementTarget, ladderSeatScore,
  type LadderScore,
} from "../lib/delivery-ladder";

const game = (winner: 0 | 1 | null, outcome: LadderScore["outcome"] = "score"): LadderScore =>
  ({ winner, outcome, faults: [null, null] });

test("placement targets move up after wins and down after losses; split sets probe the same region", () => {
  const baseline = { rating: 1500, deviation: 320 };
  const high = estimateDeliverySkill(baseline, baseline, ladderSeatScore([game(0), game(0)], 0), true);
  const low = estimateDeliverySkill(baseline, baseline, ladderSeatScore([game(1), game(1)], 0), true);
  const split = estimateDeliverySkill(baseline, baseline, ladderSeatScore([game(0), game(1)], 0), true);
  assert.ok(ladderPlacementTarget(high, 1) > baseline.rating);
  assert.ok(ladderPlacementTarget(low, 1) < baseline.rating);
  assert.equal(ladderPlacementTarget(split, 1), baseline.rating);
  assert.ok(split.deviation > high.deviation);
  assert.ok(ladderPlacementTarget(high, 5) > high.rating);
  assert.ok(ladderOpponentTarget(1500, 3) > 1500 && ladderOpponentTarget(1500, 7) < 1500);
  assert.equal(ladderSeatScore([game(null, "double_forfeit"), game(null)], 1), 0.25);
});

test("nearby new opponents take precedence; within a rating band longer waits go first", () => {
  const pool = [
    { userId: "recent", rating: 1500, dueAt: new Date(1) },
    { userId: "newer", rating: 1505, dueAt: new Date(10) },
    { userId: "longest", rating: 1465, dueAt: new Date(2) },
    { userId: "farther", rating: 1630, dueAt: new Date(0) },
  ];
  assert.equal(chooseLadderOpponent(1500, ["recent"], pool)?.userId, "longest");
  assert.equal(chooseLadderOpponent(1500, ["recent"], pool.slice(0, 1))?.userId, "recent");
  assert.equal(chooseLadderOpponent(1500, [], []), null);
});

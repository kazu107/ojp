import assert from "node:assert/strict";
import { test } from "node:test";
import { DELIVERY_PYTHON_TEMPLATE } from "../lib/delivery-templates";
import { playDeliveryMatch } from "../lib/delivery-runtime";
import { deliveryTestBots } from "./delivery-bots";

Object.assign(process.env, { NODE_ENV: "test" });
process.env.OJP_GAME_UNSAFE_LOCAL_TEST = "1";

const waitBot = {
  language: "javascript",
  sourceCode: `const lines = require("node:readline").createInterface({input: process.stdin, crlfDelay: Infinity});
let remaining = 0;
lines.on("line", line => {
  if (!remaining) {
    if (line === "END") { lines.close(); return; }
    const fields = line.split(" ").map(Number);
    remaining = fields[2] + fields[11];
  } else if (!--remaining) process.stdout.write("WAIT\\n");
});`,
} as const;

test("real Python starter and JavaScript bots finish a 100-turn match", { timeout: 45000 }, async () => {
  const result = await playDeliveryMatch(11, false, [{ language: "python", sourceCode: DELIVERY_PYTHON_TEMPLATE }, waitBot]);
  assert.deepEqual(result.faults, [null, null]);
  assert.equal(result.frames.length, 101);
  assert.equal(result.winner, 0);
  assert.ok(result.totals[0] > 0);
  assert.equal(result.totals[1], 0);
});

test("extra commands forfeit instead of being used on the next turn", { timeout: 15000 }, async () => {
  const result = await playDeliveryMatch(11, false, [
    { ...waitBot, sourceCode: waitBot.sourceCode.replace("WAIT\\n", "WAIT\\nWAIT\\n") }, waitBot,
  ]);
  assert.equal(result.winner, 1);
  assert.equal(result.outcome, "forfeit");
  assert.match(result.faults[0] ?? "", /one valid action|Unexpected action/);
});

test("two isolated matches share one compilation and use fresh runnable copies", {
  skip: process.platform !== "linux" || process.env.JUDGE_SANDBOX !== "bubblewrap", timeout: 25000,
}, async () => {
  const sources = [deliveryTestBots.vertical, deliveryTestBots.wait] as const;
  const options = { versions: ["cache-test-c", "cache-test-js"] as [string, string], queuedMs: 123 };
  const play = () => playDeliveryMatch(11, false, [...sources], options);
  const runs = await Promise.all([play(), play()]);
  for (const r of runs) {
    assert.deepEqual(r.faults, [null, null]);
    assert.equal(r.frames.length, 101);
    assert.equal(r.timing?.queuedMs, 123);
    assert.ok(r.timing && r.timing.prepareMs >= r.timing.compileMs && r.timing.playMs > 0);
  }
  assert.equal(runs.reduce((sum, r) => sum + (r.timing?.cacheHits ?? 0), 0), 2);
  const warm = await play();
  assert.equal(warm.timing?.cacheHits, 2);
  assert.equal(warm.timing?.compileMs, 0);
  assert.deepEqual(warm.frames, runs[0].frames);
});

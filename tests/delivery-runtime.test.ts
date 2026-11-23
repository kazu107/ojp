import assert from "node:assert/strict";
import { test } from "node:test";
import { DELIVERY_PYTHON_TEMPLATE } from "../lib/delivery-templates";
import { playDeliveryMatch } from "../lib/delivery-runtime";

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

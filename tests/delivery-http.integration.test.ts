import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import type { DeliveryResult } from "../lib/delivery-game";
import { deliveryLiveKey } from "../lib/delivery-evaluation";
import { deliveryTestBots as bots } from "./delivery-bots";

const origin = process.env.DELIVERY_TEST_ORIGIN;
test("HTTP: six accounts, five languages, incremental live standings and official evaluation",
  { skip: !origin, timeout: 220000 }, async () => {
    assert.equal(origin, "http://127.0.0.1:3118");
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/ojp_delivery_test");
    assert.equal(process.env.JUDGE_SANDBOX, "bubblewrap");
    const db = new PrismaClient();
    const cookie = async (login: string) => `authjs.session-token=${await encode({
      secret: "delivery-local-validation-only", salt: "authjs.session-token", maxAge: 1200,
      token: { sub: login, oauthProvider: "github", oauthAccountId: login, oauthLogin: login, oauthName: login },
    })}; ojp_locale=en`;
    const admin = await cookie("delivery-admin"), a = await cookie("delivery-a"), b = await cookie("delivery-b");
    const [c, d, e, f] = await Promise.all(["c", "d", "e", "f"].map(letter => cookie("delivery-" + letter)));
    async function page(path: string, auth = "ojp_locale=en", status = 200) {
      const response = await fetch(origin + path, { headers: { Cookie: auth }, signal: AbortSignal.timeout(12000) });
      const html = await response.text();
      assert.equal(response.status, status, path);
      return html;
    }
    async function action(auth: string, body: object, status: number, from = origin) {
      const response = await fetch(origin + "/api/games/delivery", {
        method: "POST", headers: { Cookie: auth, Origin: from!, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
      });
      assert.equal(response.status, status, await response.clone().text());
      return response.json();
    }
    async function until<T>(read: () => Promise<T>, done: (value: T) => boolean) {
      for (let count = 0; count < 260; count++) {
        const value = await read();
        if (done(value)) return value;
        await pause(300);
      }
      throw new Error("Worker did not finish");
    }
    const source = bots.greedy;
    type Fixtures = Awaited<ReturnType<typeof getFixtures>>;
    function getFixtures(evaluationId: string) {
      return db.deliveryMatch.findMany({ where: { evaluationId },
        select: { id: true, versionA: true, versionB: true, status: true, attempts: true, result: true } });
    }
    async function live(expected: string[]) {
      const key = deliveryLiveKey(expected.map(versionId => ({ versionId, userId: "", name: "" })));
      const started = Date.now();
      const saved = await until(() => db.deliveryEvaluation.findUnique({ where: { key } }),
        row => row?.status === "published" || row?.status === "failed");
      assert.equal(saved?.status, "published");
      const fixtures = await getFixtures(saved.id);
      assert.equal(fixtures.length, expected.length * (expected.length - 1));
      assert.ok(fixtures.every(m => m.status === "completed" && m.attempts <= 1));
      const reused = fixtures.filter(m => m.attempts === 0).length;
      console.log(`[live] ${expected.length} entries, ${fixtures.length - reused} played, ${reused} reused, ${Date.now() - started} ms`);
      return { fixtures, reused, standings: saved.standings as { name: string; wins: number; points: number; losses: number }[] };
    }
    function results(fixtures: Fixtures) {
      return fixtures.map(match => ({ ...match, result: match.result as unknown as DeliveryResult & { reusedFrom?: string } }));
    }
    try {
      assert.match(await page("/games"), /Delivery Duel/);
      assert.match(await page("/games/delivery", "ojp_locale=ja"), /デリバリー対決/);
      assert.match(await page("/games/delivery", a), /Try against the standard bot/);
      await action("", { action: "trial", ...source }, 401);
      await action(a, { action: "trial", ...source }, 403, "https://untrusted.invalid");
      await action(a, { action: "start" }, 403);
      const trial = await action(a, { action: "trial", ...source }, 202);
      const privatePath = "/games/delivery/matches/" + trial.id;
      await page(privatePath, b, 404);
      await page(privatePath, "ojp_locale=en", 404);
      const practice = await until(
        () => db.deliveryMatch.findUniqueOrThrow({ where: { id: trial.id } }),
        row => row.status === "completed" || row.status === "failed",
      );
      assert.equal(practice.status, "completed");
      assert.equal(practice.attempts, 1);
      const result = practice.result as unknown as DeliveryResult;
      assert.deepEqual(result.faults, [null, null]);
      assert.equal(result.frames.length, 101);
      const owned = await page(privatePath, a);
      assert.match(owned, /Standard delivery bot/);
      assert.match(owned, /Turn history/);
      assert.match(owned, /Match timing/);
      assert.match(owned, /Order events and score breakdown/);
      await page(privatePath, b, 404);
      const one = "Courier Alpha", two = "Courier Beta";
      const first = await action(a, { action: "register", ...source, name: one }, 201);
      const second = await action(b, { action: "register", ...bots.wait, name: two }, 201);
      const opening = await live([first.id, second.id]);
      assert.deepEqual(opening.standings.map(row => [row.name, row.points]), [[one, 6], [two, 0]]);
      const [third, fourth, fifth, sixth] = await Promise.all([
        action(c, { action: "register", ...bots.patrol, name: "Patrol C++" }, 201),
        action(d, { action: "register", ...bots.walk, name: "Walker Ruby" }, 201),
        action(e, { action: "register", ...bots.vertical, name: "Vertical C" }, 201),
        action(f, { action: "register", ...bots.invalid, name: "Invalid JavaScript" }, 201),
      ]);
      const versions = [first.id, second.id, third.id, fourth.id, fifth.id, sixth.id];
      const expanded = await live(versions);
      assert.ok(expanded.reused >= 2);
      assert.equal(expanded.standings[0].name, one);
      assert.equal(expanded.standings.find(row => row.name === "Invalid JavaScript")?.losses, 10);
      for (const fixture of results(expanded.fixtures)) {
        if (fixture.versionA === sixth.id || fixture.versionB === sixth.id) {
          assert.equal(fixture.result.outcome, "forfeit");
        } else if (fixture.attempts === 1) {
          assert.equal(fixture.result.frames.length, 101);
          assert.deepEqual(fixture.result.faults, [null, null]);
        }
      }
      const copied = results(expanded.fixtures).find(m => m.result.reusedFrom);
      assert.ok(copied && copied.attempts === 0);
      assert.match(await page("/games/delivery/matches/" + copied.id), /Turn history/);
      assert.match(await page("/games/delivery/matches/" + copied.id), /Original match timing/);
      const replacementBody = { action: "register", ...bots.wait, name: "Fixed JavaScript" };
      const fixed = await action(f, replacementBody, 201);
      assert.equal((await action(f, replacementBody, 201)).id, fixed.id);
      const updated = await live([...versions.slice(0, 5), fixed.id]);
      assert.equal(updated.reused, 20);
      assert.ok(results(updated.fixtures).every(m => m.result.outcome === "score"));
      assert.match(await page("/games/delivery"), /Fixed JavaScript/);
      await action(f, { action: "withdraw" }, 200);
      await live(versions.slice(0, 5));
      assert.doesNotMatch(await page("/games/delivery"), /Fixed JavaScript/);
      // Withdraw the extra accounts to check official evaluation independently.
      await Promise.all([c, d, e].map(auth => action(auth, { action: "withdraw" }, 200)));
      const round = await action(admin, { action: "start" }, 202);
      const saved = await until(
        () => db.deliveryEvaluation.findUniqueOrThrow({ where: { id: round.evaluation.id } }),
        row => row.status === "published" || row.status === "failed",
      );
      assert.equal(saved.status, "published");
      const fixtures = await getFixtures(saved.id);
      assert.equal(fixtures.length, 6);
      assert.ok(fixtures.every(m => m.status === "completed" && m.attempts === 1));
      assert.ok(fixtures.every(m => (m.result as unknown as DeliveryResult).frames.length === 101));
      const standings = await page("/games/delivery?view=official");
      assert.match(standings, /Courier Alpha/);
      assert.match(standings, /Courier Beta/);
      assert.match(standings, /Bottleneck city/);
      assert.doesNotMatch(standings, /from collections import deque/);
      assert.match(await page("/games/delivery/matches/" + fixtures[0].id), /Turn history/);
    } finally { await db.$disconnect(); }
  });

import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import { DELIVERY_PYTHON_TEMPLATE } from "../lib/delivery-templates";
import type { DeliveryResult } from "../lib/delivery-game";

const origin = process.env.DELIVERY_TEST_ORIGIN;
test("HTTP: private trial, two player registrations, admin round, public standings and replay",
  { skip: !origin, timeout: 120000 }, async () => {
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
      for (let count = 0; count < 180; count++) {
        const value = await read();
        if (done(value)) return value;
        await pause(300);
      }
      throw new Error("Worker did not finish");
    }
    const source = { sourceCode: DELIVERY_PYTHON_TEMPLATE, language: "python" };
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
      await page(privatePath, b, 404);
      const one = "Courier Alpha", two = "Courier Beta";
      await action(a, { action: "register", ...source, name: one }, 201);
      await action(b, { action: "register", ...source, name: two }, 201);
      const round = await action(admin, { action: "start" }, 202);
      const saved = await until(
        () => db.deliveryEvaluation.findUniqueOrThrow({ where: { id: round.evaluation.id } }),
        row => row.status === "published" || row.status === "failed",
      );
      assert.equal(saved.status, "published");
      const fixtures = await db.deliveryMatch.findMany({
        where: { evaluationId: saved.id }, select: { id: true, status: true, attempts: true, result: true },
      });
      assert.equal(fixtures.length, 6);
      assert.ok(fixtures.every(m => m.status === "completed" && m.attempts === 1));
      assert.ok(fixtures.every(m => (m.result as unknown as DeliveryResult).frames.length === 101));
      const standings = await page("/games/delivery");
      assert.match(standings, /Courier Alpha/);
      assert.match(standings, /Courier Beta/);
      assert.doesNotMatch(standings, /from collections import deque/);
      assert.match(await page("/games/delivery/matches/" + fixtures[0].id), /Turn history/);
    } finally { await db.$disconnect(); }
  });

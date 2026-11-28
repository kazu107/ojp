import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { deliveryTestBots as bots } from "./delivery-bots";

const agent = "/api/agent/v1/delivery";
const browser = "/api/agent-access";
const origin = process.env.DELIVERY_TEST_ORIGIN;
const exec = promisify(execFile);

function toolData(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  assert.ok(!result.isError);
  const data = result.structuredContent;
  assert.ok(data && typeof data === "object" && !Array.isArray(data));
  return data as Record<string, unknown>;
}

test("agent connection, private isolated trial, scoped tokens and atomic browser review", {
  skip: !origin, timeout: 100000,
}, async () => {
  assert.equal(origin, "http://127.0.0.1:3118");
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/ojp_delivery_test");
  assert.equal(process.env.JUDGE_SANDBOX, "bubblewrap");
  assert.equal(process.env.DELIVERY_AGENT_ENABLED, "1");
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const secret = "delivery-local-validation-only", salt = "authjs.session-token";
  const cookie = async (name: string) => {
    const login = name === "admin" ? "delivery-admin" : "agent-" + name + "-" + suffix;
    return `${salt}=${await encode({ secret, salt, maxAge: 3600, token: {
      sub: login, oauthProvider: "github", oauthAccountId: login, oauthLogin: login, oauthName: login,
    } })}; ojp_locale=en`;
  };
  const [alice, bob, admin] = await Promise.all(["alice", "bob", "admin"].map(cookie));
  let worker: ReturnType<typeof spawn> | undefined;
  let mcp: Client | undefined;
  let log = "";

  async function request(path: string, expected: number, options: {
    cookie?: string; token?: string; body?: object; key?: string; origin?: string; method?: string;
  } = {}) {
    const headers: Record<string, string> = {};
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.token) headers.Authorization = "Bearer " + options.token;
    if (options.key) headers["Idempotency-Key"] = options.key;
    if (options.body) {
      headers["Content-Type"] = "application/json";
      headers.Origin = options.origin ?? origin!;
    }
    const r = await fetch(origin + path, { headers, method: options.method ?? (options.body ? "POST" : "GET"),
      body: options.body ? JSON.stringify(options.body) : undefined, redirect: "manual", signal: AbortSignal.timeout(12000) });
    assert.equal(r.status, expected, path);
    return r;
  }
  async function json(path: string, expected: number, options: Parameters<typeof request>[2] = {}) {
    return (await request(path, expected, options)).json();
  }
  async function issue(auth: string, allowDrafts: boolean) {
    const response = await request(browser + "/tokens", 201, { cookie: auth, body: { label: "Test", allowDrafts } });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    return response.json();
  }
  const connect = (token: string) => ({ OJP_AGENT_URL: origin!, OJP_AGENT_TOKEN: token });

  try {
    const { user } = await json("/api/me", 200, { cookie: alice });
    await json("/api/me", 200, { cookie: bob });
    await request(browser + "/tokens", 403, { cookie: alice, origin: "https://other.invalid", body: { label: "Test", allowDrafts: true } });
    const basic = await issue(alice, false), capable = await issue(alice, true), other = await issue(bob, false);
    assert.match(capable.secret, /^ojp_agent_v1_[A-Za-z0-9_-]{43}$/);
    assert.ok(!JSON.stringify(capable.token).includes(capable.secret));
    const dbToken = await db.agentAccessToken.findUniqueOrThrow({ where: { id: capable.token.id } });
    assert.ok(dbToken.digest === createHash("sha256").update(capable.secret).digest("hex"));
    const settings = await (await request("/me/agent", 200, { cookie: alice })).text();
    assert.match(settings, /Coding agent connection/);
    assert.ok(!settings.includes(capable.secret) && !settings.includes(dbToken.digest));
    await request(agent + "/game", 401, { cookie: alice });
    await request(agent + "/game", 401, { token: "ojp_agent_v1_" + "a".repeat(43) });
    await request(browser + "/tokens", 401, { token: capable.secret, body: { label: "Test", allowDrafts: true } });
    await request(agent + "/drafts", 403, { token: basic.secret, body: { name: "Test", trialId: randomUUID(), ...bots.greedy } });
    await request("/api/games/delivery", 401, { token: capable.secret, body: { action: "register", name: "Forbidden", ...bots.greedy } });

    const cli = await exec(process.execPath, ["scripts/ojp-agent.mjs", "game"], {
      env: { ...process.env, ...connect(capable.secret) }, timeout: 15000,
    });
    assert.equal(JSON.parse(cli.stdout).id, "delivery");
    const transport = new StdioClientTransport({
      command: process.execPath, args: ["scripts/ojp-agent.mjs", "mcp"], env: connect(capable.secret),
    });
    mcp = new Client({ name: "ojp-agent-test", version: "1.0.0" });
    await mcp.connect(transport);
    assert.deepEqual((await mcp.listTools()).tools.map(tool => tool.name).sort(),
      ["get_game", "get_trial", "prepare_registration", "run_trial"]);
    const key = randomUUID(), toolTrial = toolData(await mcp.callTool({ name: "run_trial", arguments: { ...bots.greedy, requestKey: key } }));
    const trialId = String(toolTrial.id);
    assert.equal(toolTrial.status, "queued");
    assert.equal((await json(agent + "/trials", 202, { token: basic.secret, key, body: bots.greedy })).id, trialId);
    await request(agent + "/trials", 409, { token: capable.secret, key, body: { ...bots.greedy, sourceCode: "print('different')" } });
    await request(agent + "/trials", 409, { token: capable.secret, key: randomUUID(), body: bots.greedy });
    await request(agent + "/trials/" + trialId, 404, { token: other.secret });
    await request("/games/delivery/matches/" + trialId, 404, { cookie: bob });
    await request(agent + "/drafts", 409, { token: capable.secret, body: { trialId, name: "Too early", ...bots.greedy } });

    worker = spawn(process.execPath, ["--import", "tsx", "scripts/judge-worker.ts"], {
      env: { ...process.env, JUDGE_PROCESS_MODE: "worker", DELIVERY_LIVE_ENABLED: "0", DYNO: "delivery-agent-test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [worker.stdout, worker.stderr])
      stream?.on("data", chunk => { log = (log + chunk.toString()).slice(-5000); });
    let result: Record<string, unknown> | undefined;
    for (const deadline = Date.now() + 40000; Date.now() < deadline; await pause(250)) {
      assert.equal(worker.exitCode, null);
      result = toolData(await mcp.callTool({ name: "get_trial", arguments: { trialId } }));
      if (result?.status === "completed") break;
    }
    assert.equal(result?.status, "completed");
    assert.equal((result?.result as { turns?: number })?.turns, 100);
    assert.ok(!JSON.stringify(result).includes("from collections import deque"));
    assert.equal(await db.deliveryMatch.count({ where: { id: trialId, ownerId: user.id, attempts: 1 } }), 1);
    await request(agent + "/drafts", 409, { token: capable.secret,
      body: { ...bots.greedy, sourceCode: "print('untested')", trialId, name: "Different" } });

    const draftBody = { ...bots.greedy, trialId, name: "Approved courier" };
    const draft = toolData(await mcp.callTool({ name: "prepare_registration", arguments: draftBody }));
    assert.ok(typeof draft.id === "string" && typeof draft.reviewPath === "string" && typeof draft.sourceDigest === "string");
    const confirm = (id: string) => browser + "/delivery/drafts/" + id + "/confirm";
    assert.equal(await db.deliveryBotVersion.count({ where: { userId: user.id } }), 0);
    await request(draft.reviewPath, 404, { cookie: bob });
    assert.match(await (await request(draft.reviewPath, 200, { cookie: alice })).text(), /Approve and register bot/);
    await request(confirm(draft.id), 401, { token: capable.secret, body: { sourceDigest: draft.sourceDigest } });
    await request(confirm(draft.id), 404, { cookie: bob, body: { sourceDigest: draft.sourceDigest } });

    const existing = await json("/api/games/delivery", 201, { cookie: alice,
      body: { action: "register", name: "Existing bot", ...bots.wait } });
    await request(confirm(draft.id), 409, { cookie: alice, body: { sourceDigest: draft.sourceDigest } });
    const fresh = await json(agent + "/drafts", 201, { token: capable.secret, body: draftBody });
    const reviewed = await (await request(fresh.reviewPath, 200, { cookie: alice })).text();
    assert.match(reviewed, /Changes starting at line/);
    assert.match(reviewed, /from collections import deque/);
    await request(confirm(fresh.id), 409, { cookie: alice, body: { sourceDigest: "bad-digest" } });
    await request(confirm(fresh.id), 403, { cookie: alice, origin: "https://other.invalid", body: { sourceDigest: fresh.sourceDigest } });
    const attempts = await Promise.all([1, 2].map(() =>
      json(confirm(fresh.id), 200, { cookie: alice, body: { sourceDigest: fresh.sourceDigest } })));
    assert.equal(attempts[0].versionId, attempts[1].versionId);
    const active = await db.deliveryBotVersion.findFirstOrThrow({ where: { userId: user.id, validUntil: null } });
    assert.equal(active.id, attempts[0].versionId);
    assert.notEqual(active.id, existing.id);
    assert.equal(active.sourceCode, bots.greedy.sourceCode);
    assert.equal(await db.deliveryBotVersion.count({ where: { userId: user.id } }), 2);
    assert.equal((await db.agentDeliveryDraft.findUniqueOrThrow({ where: { id: fresh.id } })).sourceCode, null);

    const pending = await json(agent + "/drafts", 201, { token: capable.secret, body: draftBody });
    await request(browser + "/tokens/" + capable.token.id + "/revoke", 200, { cookie: alice, body: {} });
    await request(agent + "/game", 401, { token: capable.secret });
    await request(confirm(pending.id), 410, { cookie: alice, body: { sourceDigest: pending.sourceDigest } });
    await db.agentAccessToken.update({ where: { id: other.token.id }, data: { expiresAt: new Date(0) } });
    await request(agent + "/game", 401, { token: other.secret });
    await request("/api/admin/users/" + user.id + "/freeze", 200, { cookie: admin, body: { reason: "Agent token status test" } });
    await request(agent + "/game", 403, { token: basic.secret });
  } catch (error) {
    if (log) console.error(log);
    throw error;
  } finally {
    if (mcp) await mcp.close();
    worker?.kill("SIGTERM");
    await db.$disconnect();
  }
});

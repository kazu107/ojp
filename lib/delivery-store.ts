import { randomBytes, randomUUID } from "node:crypto";
import { Prisma, type DeliveryMatch } from "@prisma/client";
import { prisma } from "./db/prisma";
import { isSubmissionLanguage } from "./languages";
import { isWellFormedText } from "./board-visualization";
import { DELIVERY_MAX_ENTRIES, DELIVERY_RULES, type DeliveryResult } from "./delivery-game";
import { planDeliveryMatches, rankDelivery, weeklyDeliveryCutoff, type ArenaEntry, type DeliveryStanding } from "./delivery-evaluation";
import { DELIVERY_SOURCE_BYTES, playDeliveryMatch, type DeliveryBotSource } from "./delivery-runtime";

const LEASE_MS = 120000;
const MAX_ATTEMPTS = 3;
const CLAIMABLE = ["queued", "running"];
const seed = () => randomBytes(4).readUInt32BE(0) & 0x7fffffff;

export const deliveryEnabled = () => process.env.DELIVERY_ARENA_ENABLED === "1";
export class DeliveryError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function guardEnabled() {
  if (!deliveryEnabled()) throw new DeliveryError("Delivery arena is disabled", 404);
}
async function locked<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ojp-delivery-arena-v1'))::text`;
    return fn(tx);
  });
}
function botSource(raw: unknown): DeliveryBotSource {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DeliveryError("Invalid delivery bot");
  const { language, sourceCode } = raw as Record<string, unknown>;
  if (!isSubmissionLanguage(language) || typeof sourceCode !== "string" || !sourceCode.trim() ||
      sourceCode.includes("\0") || !isWellFormedText(sourceCode) ||
      Buffer.byteLength(sourceCode, "utf8") > DELIVERY_SOURCE_BYTES) throw new DeliveryError("Invalid delivery bot");
  return { language, sourceCode };
}
export async function registerDeliveryBot(userId: string, name: unknown, raw: unknown) {
  guardEnabled();
  const source = botSource(raw);
  if (typeof name !== "string" || !name.trim() || name.length > 40 ||
      Array.from(name).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || !isWellFormedText(name))
    throw new DeliveryError("Invalid delivery bot name");
  const label = name.trim();
  return locked(async tx => {
    const now = new Date();
    const active = await tx.deliveryBotVersion.findFirst({ where: { userId, validUntil: null }, select: { id: true } });
    if (!active && await tx.deliveryBotVersion.count({ where: { validUntil: null } }) >= DELIVERY_MAX_ENTRIES)
      throw new DeliveryError("Delivery registration is full", 409);
    if (await tx.deliveryBotVersion.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - 3600000) } } }) >= 20)
      throw new DeliveryError("Too many delivery registrations", 429);
    if (active) await tx.deliveryBotVersion.update({ where: { id: active.id }, data: { validUntil: now } });
    return tx.deliveryBotVersion.create({
      data: { ...source, id: randomUUID(), userId, name: label, createdAt: now },
      select: { id: true, name: true, language: true, createdAt: true },
    });
  });
}
export async function withdrawDeliveryBot(userId: string) {
  guardEnabled();
  await locked(tx => tx.deliveryBotVersion.updateMany({ where: { userId, validUntil: null }, data: { validUntil: new Date() } }));
}

export async function enqueueDeliveryTrial(ownerId: string, raw: unknown) {
  guardEnabled();
  const source = botSource(raw);
  return locked(async tx => {
    if (await tx.deliveryMatch.count({ where: { ownerId, status: { in: CLAIMABLE } } }))
      throw new DeliveryError("A delivery trial is already queued", 409);
    if (await tx.deliveryMatch.count({ where: { ownerId, createdAt: { gte: new Date(Date.now() - 30000) } } }))
      throw new DeliveryError("Please wait 30 seconds before another delivery trial", 429);
    if (await tx.deliveryMatch.count({ where: { evaluationId: null, status: { in: CLAIMABLE } } }) >= 8)
      throw new DeliveryError("Delivery trial queue is full", 429);
    return tx.deliveryMatch.create({
      data: { id: randomUUID(), ownerId, ordinal: 0, trialSource: source, rules: DELIVERY_RULES,
        seed: 11, flipped: false, status: "queued" },
      select: { id: true, status: true },
    });
  });
}

export async function startDeliveryEvaluation(kind: "manual" | "weekly", now = new Date()) {
  guardEnabled();
  const window = kind === "weekly" ? weeklyDeliveryCutoff(now) : { key: "manual:" + randomUUID(), cutoff: now };
  return locked(async tx => {
    if (await tx.deliveryEvaluation.findUnique({ where: { key: window.key }, select: { id: true } })) return null;
    if (await tx.deliveryEvaluation.count({ where: { status: { in: ["active", "failed"] } } })) {
      if (kind === "weekly") return null;
      throw new DeliveryError("Resolve the current delivery evaluation first", 409);
    }
    const versions = await tx.deliveryBotVersion.findMany({
      where: { createdAt: { lte: window.cutoff }, OR: [{ validUntil: null }, { validUntil: { gt: window.cutoff } }] },
      select: { id: true, userId: true, name: true },
      orderBy: { userId: "asc" }, take: DELIVERY_MAX_ENTRIES + 1,
    });
    const entries = versions.map(v => ({ userId: v.userId, versionId: v.id, name: v.name }));
    if (entries.length < 2) {
      if (kind === "weekly") return null;
      throw new DeliveryError("At least two registered delivery bots are required", 400);
    }
    if (entries.length > DELIVERY_MAX_ENTRIES || new Set(entries.map(v => v.userId)).size !== entries.length)
      throw new Error("Invalid delivery enrollment snapshot");
    const seeds = new Set<number>();
    while (seeds.size < 3) seeds.add(seed());
    const id = randomUUID();
    await tx.deliveryEvaluation.create({ data: { id, ...window, kind, status: "active", entries } });
    await tx.deliveryMatch.createMany({ data: planDeliveryMatches(entries, [...seeds]).map(plan => ({
      id: randomUUID(), evaluationId: id, ...plan,
    })) });
    return { id };
  });
}

export async function retryDeliveryEvaluation(id: string) {
  guardEnabled();
  await locked(async tx => {
    const e = await tx.deliveryEvaluation.findFirst({ where: { id, status: "failed" }, select: { id: true } });
    if (!e) throw new DeliveryError("No failed delivery evaluation to retry", 404);
    await tx.deliveryMatch.updateMany({
      where: { evaluationId: id, status: "failed" },
      data: { status: "queued", attempts: 0, token: null, leaseUntil: null, finishedAt: null },
    });
    await tx.deliveryEvaluation.update({ where: { id }, data: { status: "active" } });
  });
}

async function settleDeliveryEvaluation(id: string) {
  await locked(async tx => {
    const e = await tx.deliveryEvaluation.findFirst({ where: { id, status: "active" }, select: { entries: true } });
    if (!e || await tx.deliveryMatch.count({ where: { evaluationId: id, status: { in: CLAIMABLE } } })) return;
    const matches = await tx.$queryRaw<{ status: string; versionA: string | null; versionB: string | null;
      result: Pick<DeliveryResult, "winner" | "outcome" | "totals"> | null }[]>`
      SELECT status, "versionA", "versionB", CASE WHEN result IS NOT NULL THEN jsonb_build_object(
        'winner', result->'winner', 'outcome', result->'outcome', 'totals', result->'totals') END AS result
      FROM "DeliveryMatch" WHERE "evaluationId" = ${id}`;
    if (matches.some(m => m.status !== "completed" || !m.versionA || !m.versionB || !m.result)) {
      await tx.deliveryEvaluation.update({ where: { id }, data: { status: "failed" } });
      return;
    }
    const entries = e.entries as ArenaEntry[];
    if (matches.length !== entries.length * (entries.length - 1) * 3) throw new Error("Incomplete delivery round robin");
    const rows = rankDelivery(entries, matches.map(m => ({
      versionA: m.versionA!, versionB: m.versionB!, result: m.result!,
    })));
    await tx.deliveryEvaluation.update({ where: { id },
      data: { status: "published", standings: rows, publishedAt: new Date() } });
  });
}

async function claimDeliveryMatch() {
  return locked(async tx => {
    const now = new Date();
    if (await tx.deliveryMatch.count({ where: { status: "running", leaseUntil: { gte: now } } })) return null;
    const token = randomUUID(), leaseUntil = new Date(now.getTime() + LEASE_MS);
    const rows = await tx.$queryRaw<DeliveryMatch[]>`
      UPDATE "DeliveryMatch" SET status='running', token=${token}, "leaseUntil"=${leaseUntil}, attempts=attempts+1
      WHERE id=(SELECT id FROM "DeliveryMatch" WHERE attempts < ${MAX_ATTEMPTS}
        AND (status='queued' OR (status='running' AND "leaseUntil" < ${now}))
        ORDER BY "createdAt", ordinal, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`;
    return rows[0] ?? null;
  });
}

let lastSchedule = 0;
export async function workOneDeliveryMatch(): Promise<boolean> {
  if (!deliveryEnabled()) return false;
  if (Date.now() - lastSchedule >= 60000) {
    lastSchedule = Date.now();
    await prisma.deliveryMatch.updateMany({
      where: { status: "running", leaseUntil: { lt: new Date() }, attempts: { gte: MAX_ATTEMPTS } },
      data: { status: "failed", token: null, leaseUntil: null, finishedAt: new Date(), trialSource: Prisma.DbNull },
    });
    const active = await prisma.deliveryEvaluation.findFirst({ where: { status: "active" }, select: { id: true } });
    if (active) await settleDeliveryEvaluation(active.id);
    if (process.env.DELIVERY_WEEKLY_ENABLED === "1") await startDeliveryEvaluation("weekly");
  }
  const job = await claimDeliveryMatch();
  if (!job) return false;
  const held = () => ({ id: job.id, token: job.token, status: "running", leaseUntil: { gt: new Date() } });
  const heartbeat = setInterval(() => {
    void prisma.deliveryMatch.updateMany({ where: held(), data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
      .catch(() => console.error("[delivery] match lease heartbeat failed"));
  }, 15000);
  heartbeat.unref?.();
  try {
    if (job.rules !== DELIVERY_RULES) throw new Error("Unexpected delivery rules version");
    const load = async (id: string | null) => {
      if (!id) throw new Error("Missing delivery bot version");
      return prisma.deliveryBotVersion.findUniqueOrThrow({ where: { id }, select: { sourceCode: true, language: true } });
    };
    const a = job.evaluationId ? await load(job.versionA) : botSource(job.trialSource);
    const b = job.evaluationId ? await load(job.versionB) : null;
    const result = await playDeliveryMatch(job.seed, job.flipped, [a, b]);
    await prisma.deliveryMatch.updateMany({ where: held(), data: {
      status: "completed", result: result as unknown as Prisma.InputJsonValue,
      token: null, leaseUntil: null, finishedAt: new Date(), trialSource: Prisma.DbNull,
    } });
  } catch {
    console.error("[delivery] match infrastructure failure", job.id);
    const retry = job.attempts < MAX_ATTEMPTS;
    await prisma.deliveryMatch.updateMany({ where: held(), data: {
      status: retry ? "queued" : "failed", token: null, leaseUntil: null, finishedAt: retry ? null : new Date(),
      ...(retry ? {} : { trialSource: Prisma.DbNull }),
    } });
  } finally { clearInterval(heartbeat); }
  if (job.evaluationId) await settleDeliveryEvaluation(job.evaluationId);
  return true;
}

export async function deliveryOverview(userId?: string, evaluationId?: string) {
  guardEnabled();
  const [history, active, bot, trials, cap] = await Promise.all([
    prisma.deliveryEvaluation.findMany({ where: { status: "published" }, orderBy: { publishedAt: "desc" },
      take: 20, select: { id: true, cutoff: true, kind: true } }),
    prisma.deliveryEvaluation.findFirst({ where: { status: { in: ["active", "failed"] } }, select: { id: true, status: true } }),
    userId ? prisma.deliveryBotVersion.findFirst({ where: { userId, validUntil: null }, select: { name: true, language: true, sourceCode: true } }) : null,
    userId ? prisma.deliveryMatch.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, status: true, createdAt: true } }) : [],
    prisma.deliveryBotVersion.count({ where: { validUntil: null } }),
  ]);
  const latest = history.find(e => e.id === evaluationId) ?? history[0];
  const evaluation = latest ? await prisma.deliveryEvaluation.findFirst({
    where: { id: latest.id, status: "published" }, select: { standings: true, entries: true,
      matches: { orderBy: { ordinal: "asc" }, select: { id: true, versionA: true, versionB: true, seed: true, flipped: true } },
    },
  }) : null;
  const progress = active ? await prisma.deliveryMatch.groupBy({ by: ["status"], where: { evaluationId: active.id }, _count: true }) : [];
  return { history, active, bot, trials, cap, latest, evaluation, progress,
    entries: evaluation?.entries as ArenaEntry[] | undefined,
    standings: evaluation?.standings as DeliveryStanding[] | undefined };
}

export async function readDeliveryMatch(id: string, viewerId?: string) {
  guardEnabled();
  // Do not hydrate any program/source code on the replay read path.
  const match = await prisma.deliveryMatch.findFirst({
    where: { id, OR: [
      { evaluation: { status: "published" }, status: "completed" },
      ...(viewerId ? [{ ownerId: viewerId }] : []),
    ] },
    select: { id: true, status: true, versionA: true, versionB: true, result: true, evaluation: { select: { entries: true } } },
  });
  if (!match) return null;
  return { status: match.status, result: match.result as unknown as DeliveryResult | null,
    names: match.evaluation ? [match.versionA, match.versionB].map(v =>
      (match.evaluation!.entries as ArenaEntry[]).find(e => e.versionId === v)?.name) : undefined };
}

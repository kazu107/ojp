import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type DeliveryMatch } from "@prisma/client";
import { prisma } from "./db/prisma";
import { isSubmissionLanguage } from "./languages";
import { isWellFormedText } from "./board-visualization";
import { DELIVERY_DEFAULT_ENTRIES, DELIVERY_MAX_ENTRIES, DELIVERY_RULES, deliveryMapForRules, type DeliveryResult } from "./delivery-game";
import { DELIVERY_LIVE_SEEDS, deliveryLiveKey, isSampledDelivery, liveMatchCount, planDeliveryMatches, rankDelivery, weeklyDeliveryCutoff, type ArenaEntry, type DeliveryStanding } from "./delivery-evaluation";
import { DELIVERY_SOURCE_BYTES, playDeliveryMatch, type DeliveryBotSource } from "./delivery-runtime";
import { deliveryLadderEnabled, isDeliveryLadderKind } from "./delivery-ladder";
import { enrollLadderVersion, scheduleLadderPair, settleLadderPair, withdrawLadderVersion } from "./delivery-ladder-store";

const LEASE_MS = 120000;
const MAX_ATTEMPTS = 3;
const CLAIMABLE = ["queued", "running"];
const LIVE_INTERVAL_MS = 2000;
const seed = () => randomBytes(4).readUInt32BE(0) & 0x7fffffff;

export const deliveryEnabled = () => process.env.DELIVERY_ARENA_ENABLED === "1";
const liveEnabled = () => process.env.DELIVERY_LIVE_ENABLED !== "0";
export const deliveryConcurrency = () => process.env.DELIVERY_MATCH_CONCURRENCY === "2" ? 2 : 1;
export function deliveryEntryLimit() {
  const limit = Number(process.env.DELIVERY_ENTRY_LIMIT);
  return Number.isInteger(limit) && limit >= 2 && limit <= DELIVERY_MAX_ENTRIES ? limit : DELIVERY_DEFAULT_ENTRIES;
}
export class DeliveryError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function guardEnabled() {
  if (!deliveryEnabled()) throw new DeliveryError("Delivery arena is disabled", 404);
}
export async function withDeliveryLock<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ojp-delivery-arena-v1'))::text`;
    return fn(tx);
  }, { maxWait: 5000, timeout: 15000 });
}
const locked = withDeliveryLock;
async function insertDeliveryMatches(tx: Prisma.TransactionClient, evaluationId: string, matches: ReturnType<typeof planDeliveryMatches>) {
  const createdAt = new Date();
  for (let offset = 0; offset < matches.length; offset += 500) {
    await tx.deliveryMatch.createMany({ data: matches.slice(offset, offset + 500).map(plan => ({
      id: randomUUID(), evaluationId, createdAt, ...plan,
    })) });
  }
}
export function parseDeliveryBotSource(raw: unknown): DeliveryBotSource {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DeliveryError("Invalid delivery bot");
  const { language, sourceCode } = raw as Record<string, unknown>;
  if (!isSubmissionLanguage(language) || typeof sourceCode !== "string" || !sourceCode.trim() ||
      sourceCode.includes("\0") || !isWellFormedText(sourceCode) ||
      Buffer.byteLength(sourceCode, "utf8") > DELIVERY_SOURCE_BYTES) throw new DeliveryError("Invalid delivery bot");
  return { language, sourceCode };
}
export function parseDeliveryBotName(name: unknown) {
  if (typeof name !== "string" || !name.trim() || name.length > 40 ||
      Array.from(name).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || !isWellFormedText(name))
    throw new DeliveryError("Invalid delivery bot name");
  return name.trim();
}
export function deliverySourceDigest(source: DeliveryBotSource) {
  return createHash("sha256").update(JSON.stringify([source.language, source.sourceCode])).digest("hex");
}
export async function registerDeliveryBot(userId: string, name: unknown, raw: unknown) {
  guardEnabled();
  return locked(tx => registerDeliveryBotLocked(tx, userId, name, raw));
}
// Kept internal to the store boundary so draft approval and registration can share one transaction.
export async function registerDeliveryBotLocked(tx: Prisma.TransactionClient, userId: string, name: unknown, raw: unknown) {
  guardEnabled();
  const source = parseDeliveryBotSource(raw), label = parseDeliveryBotName(name);
  const now = new Date();
  const active = await tx.deliveryBotVersion.findFirst({ where: { userId, validUntil: null },
    select: { id: true, name: true, language: true, sourceCode: true, createdAt: true } });
  if (active?.name === label && active.language === source.language && active.sourceCode === source.sourceCode) {
    if (deliveryLadderEnabled() && !await tx.deliveryLadderEntry.findFirst({
      where: { userId, activeVersionId: active.id }, select: { userId: true },
    })) await enrollLadderVersion(tx, { userId, versionId: active.id, name: active.name }, now);
    return { id: active.id, name: active.name, language: active.language, createdAt: active.createdAt };
  }
  if (!deliveryLadderEnabled() && !active && await tx.deliveryBotVersion.count({ where: { validUntil: null } }) >= deliveryEntryLimit())
    throw new DeliveryError("Delivery registration is full", 409);
  if (await tx.deliveryBotVersion.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - 3600000) } } }) >= 20)
    throw new DeliveryError("Too many delivery registrations", 429);
  if (active) await tx.deliveryBotVersion.update({ where: { id: active.id }, data: { validUntil: now } });
  const version = await tx.deliveryBotVersion.create({
    data: { ...source, id: randomUUID(), userId, name: label, createdAt: now },
    select: { id: true, name: true, language: true, createdAt: true },
  });
  if (deliveryLadderEnabled()) await enrollLadderVersion(tx, { userId, versionId: version.id, name: version.name }, now);
  return version;
}
export async function withdrawDeliveryBot(userId: string) {
  guardEnabled();
  await locked(async tx => {
    await tx.deliveryBotVersion.updateMany({ where: { userId, validUntil: null }, data: { validUntil: new Date() } });
    if (deliveryLadderEnabled()) await withdrawLadderVersion(tx, userId);
  });
}

export async function enqueueDeliveryTrial(ownerId: string, raw: unknown, agent?: {
  requestKey: string; authorize: (tx: Prisma.TransactionClient) => Promise<void>;
}) {
  guardEnabled();
  const source = parseDeliveryBotSource(raw);
  return locked(async tx => {
    if (agent) await agent.authorize(tx);
    const requestKey = agent?.requestKey;
    const sourceDigest = requestKey ? deliverySourceDigest(source) : undefined;
    if (requestKey) {
      const request = await tx.agentDeliveryTrial.findUnique({ where: { ownerId_requestKey: { ownerId, requestKey } } });
      if (request) {
        if (request.sourceDigest !== sourceDigest) throw new DeliveryError("Trial request key was already used for different code", 409);
        const trial = await tx.deliveryMatch.findFirst({
          where: { id: request.id, ownerId, evaluationId: null }, select: { id: true, status: true },
        });
        if (!trial) throw new DeliveryError("Trial not found", 404);
        return trial;
      }
    }
    if (await tx.deliveryMatch.count({ where: { ownerId, status: { in: CLAIMABLE } } }))
      throw new DeliveryError("A delivery trial is already queued", 409);
    if (await tx.deliveryMatch.count({ where: { ownerId, createdAt: { gte: new Date(Date.now() - 30000) } } }))
      throw new DeliveryError("Please wait 30 seconds before another delivery trial", 429);
    if (await tx.deliveryMatch.count({ where: { evaluationId: null, status: { in: CLAIMABLE } } }) >= 8)
      throw new DeliveryError("Delivery trial queue is full", 429);
    const createdAt = new Date();
    const trial = await tx.deliveryMatch.create({
      data: { id: randomUUID(), ownerId, ordinal: 0, trialSource: source, rules: DELIVERY_RULES,
        seed: 11, flipped: false, status: "queued", createdAt },
      select: { id: true, status: true },
    });
    if (requestKey && sourceDigest) await tx.agentDeliveryTrial.create({
      data: { id: trial.id, ownerId, requestKey, sourceDigest, createdAt },
    });
    return trial;
  });
}

export async function startDeliveryEvaluation(kind: "manual" | "weekly", now = new Date()) {
  guardEnabled();
  if (deliveryLadderEnabled()) throw new DeliveryError("Scheduled delivery evaluations are archived", 410);
  const window = kind === "weekly" ? weeklyDeliveryCutoff(now) : { key: "manual:" + randomUUID(), cutoff: now };
  return locked(async tx => {
    if (await tx.deliveryEvaluation.findUnique({ where: { key: window.key }, select: { id: true } })) return null;
    if (await tx.deliveryEvaluation.count({ where: { kind: { not: "live" }, status: { in: ["active", "failed"] } } })) {
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
    await tx.deliveryEvaluation.create({ data: { id, ...window, kind, status: "active", entries, createdAt: new Date() } });
    await insertDeliveryMatches(tx, id, planDeliveryMatches(entries, [...seeds], { official: true }));
    return { id };
  });
}

async function currentEntries(tx: Prisma.TransactionClient): Promise<ArenaEntry[]> {
  const versions = await tx.deliveryBotVersion.findMany({
    where: { validUntil: null }, select: { id: true, userId: true, name: true },
    orderBy: { userId: "asc" }, take: DELIVERY_MAX_ENTRIES + 1,
  });
  if (versions.length > DELIVERY_MAX_ENTRIES || new Set(versions.map(v => v.userId)).size !== versions.length)
    throw new Error("Invalid live delivery enrollment");
  return versions.map(v => ({ userId: v.userId, versionId: v.id, name: v.name }));
}

async function syncLiveEvaluation() {
  await locked(async tx => {
    const entries = await currentEntries(tx);
    const key = entries.length >= 2 ? deliveryLiveKey(entries) : null;
    const active = await tx.deliveryEvaluation.findFirst({
      where: { kind: "live", status: "active" }, select: { id: true, key: true },
    });
    if (active && active.key === key) return;
    if (active) {
      // In-flight matches keep their leases; obsolete queued matches must not keep a slot busy.
      await tx.deliveryMatch.updateMany({ where: { evaluationId: active.id, status: "queued" },
        data: { status: "cancelled", token: null, leaseUntil: null } });
      await tx.deliveryEvaluation.update({ where: { id: active.id }, data: { status: "superseded" } });
    }
    if (!key) return;
    const existing = await tx.deliveryEvaluation.findUnique({ where: { key }, select: { id: true, status: true } });
    if (existing?.status === "superseded") {
      await tx.deliveryMatch.updateMany({ where: { evaluationId: existing.id, status: { in: ["cancelled", "failed"] } },
        data: { status: "queued", attempts: 0, finishedAt: null } });
      await tx.deliveryEvaluation.update({ where: { id: existing.id }, data: { status: "active" } });
    }
    if (existing) return;
    const id = randomUUID();
    const createdAt = new Date();
    await tx.deliveryEvaluation.create({ data: { id, key, cutoff: createdAt, kind: "live", status: "active", entries, createdAt } });
    await insertDeliveryMatches(tx, id, planDeliveryMatches(entries, DELIVERY_LIVE_SEEDS, { sampled: isSampledDelivery(entries.length) }));
    const previous = await tx.deliveryEvaluation.findFirst({
      where: { kind: "live", status: "published" }, orderBy: { publishedAt: "desc" }, select: { id: true },
    });
    if (previous) {
      // Reuse summaries and link directly to the original replay, without copying its frames.
      await tx.$executeRaw`
        UPDATE "DeliveryMatch" next SET status='completed', "finishedAt"=(now() AT TIME ZONE 'UTC'),
          result=jsonb_build_object('winner', old.result->'winner', 'outcome', old.result->'outcome',
            'totals', old.result->'totals', 'reusedFrom', COALESCE(old.result->>'reusedFrom', old.id))
        FROM "DeliveryMatch" old WHERE next."evaluationId"=${id} AND old."evaluationId"=${previous.id}
          AND old.status='completed' AND old.result IS NOT NULL
          AND next."versionA"=old."versionA" AND next."versionB"=old."versionB"
          AND next.rules=old.rules AND next.seed=old.seed AND next.flipped=old.flipped`;
    }
  });
}

export async function retryDeliveryEvaluation(id: string) {
  guardEnabled();
  if (deliveryLadderEnabled()) throw new DeliveryError("Scheduled delivery evaluations are archived", 410);
  await locked(async tx => {
    const e = await tx.deliveryEvaluation.findFirst({ where: { id, status: "failed" }, select: { id: true, kind: true, key: true } });
    if (!e) throw new DeliveryError("No failed delivery evaluation to retry", 404);
    if (e.kind === "live" && (!liveEnabled() || e.key !== deliveryLiveKey(await currentEntries(tx)) ||
        await tx.deliveryEvaluation.count({ where: { kind: "live", status: "active" } })))
      throw new DeliveryError("This live evaluation no longer matches the registered bots", 409);
    await tx.deliveryMatch.updateMany({
      where: { evaluationId: id, status: "failed" },
      data: { status: "queued", attempts: 0, token: null, leaseUntil: null, finishedAt: null },
    });
    await tx.deliveryEvaluation.update({ where: { id }, data: { status: "active" } });
  });
}

async function settleDeliveryEvaluation(id: string) {
  await locked(async tx => {
    const e = await tx.deliveryEvaluation.findFirst({ where: { id, status: "active" }, select: { entries: true, kind: true } });
    if (!e || await tx.deliveryMatch.count({ where: { evaluationId: id, status: { in: CLAIMABLE } } })) return;
    const matches = await tx.$queryRaw<{ status: string; versionA: string | null; versionB: string | null;
      result: Pick<DeliveryResult, "winner" | "outcome" | "totals" | "faults"> | null }[]>`
      SELECT status, "versionA", "versionB", CASE WHEN result IS NOT NULL THEN jsonb_build_object(
        'winner', result->'winner', 'outcome', result->'outcome', 'totals', result->'totals', 'faults', result->'faults') END AS result
      FROM "DeliveryMatch" WHERE "evaluationId" = ${id}`;
    if (isDeliveryLadderKind(e.kind)) {
      const entries = e.entries as ArenaEntry[];
      const completed = matches.length === 2 && matches.every(m => m.status === "completed" && m.result?.faults?.length === 2 &&
        m.versionA === entries[0]?.versionId && m.versionB === entries[1]?.versionId);
      await settleLadderPair(tx, id, e.kind, entries, completed ? matches.map(m => m.result!) : null);
      return;
    }
    if (matches.some(m => m.status !== "completed" || !m.versionA || !m.versionB || !m.result)) {
      await tx.deliveryEvaluation.update({ where: { id }, data: { status: "failed" } });
      return;
    }
    const entries = e.entries as ArenaEntry[];
    const expected = e.kind === "live" ? liveMatchCount(entries.length) * DELIVERY_LIVE_SEEDS.length : entries.length * (entries.length - 1) * 3;
    if (matches.length !== expected) throw new Error("Incomplete delivery evaluation");
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
    await tx.deliveryMatch.updateMany({
      where: { status: "running", leaseUntil: { lt: now }, evaluation: { status: "superseded" } },
      data: { status: "cancelled", token: null, leaseUntil: null },
    });
    if (await tx.deliveryMatch.count({ where: { status: "running", leaseUntil: { gte: now } } }) >= deliveryConcurrency()) return null;
    const [priority] = await tx.$queryRaw<{ busy: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM "JudgeJob" WHERE status IN ('queued','claimed','running')) OR
             EXISTS(SELECT 1 FROM "PackageJob" WHERE status IN ('queued','claimed','running')) OR
             EXISTS(SELECT 1 FROM "HeuristicRun" WHERE status IN ('queued','running')) AS busy`;
    if (priority?.busy) return null;
    const token = randomUUID(), leaseUntil = new Date(now.getTime() + LEASE_MS);
    // Prisma DateTime columns are UTC timestamps without time zone.
    const rows = await tx.$queryRaw<DeliveryMatch[]>`
      UPDATE "DeliveryMatch" SET status='running', token=${token}, "leaseUntil"=CAST(${leaseUntil.toISOString()} AS timestamp), attempts=attempts+1
      WHERE id=(SELECT m.id FROM "DeliveryMatch" m LEFT JOIN "DeliveryEvaluation" e ON e.id=m."evaluationId"
        WHERE m.attempts < ${MAX_ATTEMPTS} AND (m."evaluationId" IS NULL OR e.status='active')
          AND (m.status='queued' OR (m.status='running' AND m."leaseUntil" < CAST(${now.toISOString()} AS timestamp)))
        ORDER BY CASE WHEN e.kind='live' OR m."evaluationId" IS NULL THEN 0 ELSE 1 END,
          m."createdAt", m.ordinal, m.id LIMIT 1 FOR UPDATE OF m SKIP LOCKED)
      RETURNING *`;
    return rows[0] ? { job: rows[0], claimedAt: now.getTime() } : null;
  });
}

let lastSchedule = 0;
let lastLiveSchedule = 0;
export async function startDeliveryWork(): Promise<{ done: Promise<void> } | null> {
  if (!deliveryEnabled()) return null;
  if (Date.now() - lastSchedule >= 60000) {
    lastSchedule = Date.now();
    await prisma.deliveryMatch.updateMany({
      where: { status: "running", leaseUntil: { lt: new Date() }, attempts: { gte: MAX_ATTEMPTS },
        OR: [{ evaluationId: null }, { evaluation: { status: "active" } }] },
      data: { status: "failed", token: null, leaseUntil: null, finishedAt: new Date(), trialSource: Prisma.DbNull },
    });
    const active = await prisma.deliveryEvaluation.findMany({ where: { status: "active" }, select: { id: true } });
    for (const evaluation of active) await settleDeliveryEvaluation(evaluation.id);
  }
  if (liveEnabled() && Date.now() - lastLiveSchedule >= LIVE_INTERVAL_MS) {
    lastLiveSchedule = Date.now();
    if (deliveryLadderEnabled()) {
      await locked(tx => scheduleLadderPair(tx));
    } else {
      await syncLiveEvaluation();
      const live = await prisma.deliveryEvaluation.findFirst({ where: { kind: "live", status: "active" }, select: { id: true } });
      if (live) await settleDeliveryEvaluation(live.id);
    }
  }
  const claim = await claimDeliveryMatch();
  return claim ? { done: executeDeliveryMatch(claim.job, claim.claimedAt) } : null;
}

export async function workOneDeliveryMatch(): Promise<boolean> {
  const work = await startDeliveryWork();
  if (!work) return false;
  await work.done;
  return true;
}

async function executeDeliveryMatch(job: DeliveryMatch, claimedAt: number) {
  const held = () => ({ id: job.id, token: job.token, status: "running", leaseUntil: { gt: new Date() } });
  const heartbeat = setInterval(() => {
    void prisma.deliveryMatch.updateMany({ where: held(), data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
      .catch(() => console.error("[delivery] match lease heartbeat failed"));
  }, 15000);
  heartbeat.unref?.();
  try {
    const map = deliveryMapForRules(job.rules);
    if (!map) throw new Error("Unexpected delivery rules version");
    const load = async (id: string | null) => {
      if (!id) throw new Error("Missing delivery bot version");
      return prisma.deliveryBotVersion.findUniqueOrThrow({ where: { id }, select: { sourceCode: true, language: true } });
    };
    const a = job.evaluationId ? await load(job.versionA) : parseDeliveryBotSource(job.trialSource);
    const b = job.evaluationId ? await load(job.versionB) : null;
    const result = await playDeliveryMatch(job.seed, job.flipped, [a, b], {
      map, versions: [job.versionA, job.versionB], queuedMs: Math.max(0, claimedAt - job.createdAt.getTime()),
    });
    await prisma.deliveryMatch.updateMany({ where: held(), data: {
      status: "completed", result: result as unknown as Prisma.InputJsonValue,
      token: null, leaseUntil: null, finishedAt: new Date(), trialSource: Prisma.DbNull,
    } });
  } catch {
    console.error("[delivery] match infrastructure failure", job.id);
    await locked(async tx => {
      const active = !job.evaluationId || (await tx.deliveryEvaluation.findUnique({
        where: { id: job.evaluationId }, select: { status: true },
      }))?.status === "active";
      const retry = active && job.attempts < MAX_ATTEMPTS;
      await tx.deliveryMatch.updateMany({ where: held(), data: {
        status: retry ? "queued" : active ? "failed" : "cancelled",
        token: null, leaseUntil: null, finishedAt: retry ? null : new Date(),
        ...(retry ? {} : { trialSource: Prisma.DbNull }),
      } });
    });
  } finally { clearInterval(heartbeat); }
  if (job.evaluationId) await settleDeliveryEvaluation(job.evaluationId);
}

export const DELIVERY_REPLAY_PAGE_SIZE = 60;
export async function deliveryOverview(userId?: string, evaluationId?: string, view: "live" | "official" = "official", replayPage = 1) {
  guardEnabled();
  const archived = deliveryLadderEnabled();
  const liveAvailable = !archived && liveEnabled();
  const live = view === "live" && liveAvailable;
  const kinds = live ? ["live"] : archived ? ["weekly", "manual", "live"] : ["weekly", "manual"];
  const [history, official, bot, trials, roster] = await Promise.all([
    prisma.deliveryEvaluation.findMany({ where: { status: "published", kind: { in: kinds } }, orderBy: { publishedAt: "desc" },
      take: live ? 1 : 20, select: { id: true, cutoff: true, kind: true } }),
    !live && !archived ? prisma.deliveryEvaluation.findFirst({ where: { kind: { in: kinds }, status: { in: ["active", "failed"] } },
      select: { id: true, status: true } }) : null,
    userId ? prisma.deliveryBotVersion.findFirst({ where: { userId, validUntil: null }, select: { name: true, language: true, sourceCode: true } }) : null,
    userId ? prisma.deliveryMatch.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, status: true, createdAt: true } }) : [],
    live ? currentEntries(prisma) : prisma.deliveryBotVersion.count({ where: { validUntil: null } }),
  ]);
  const cap = typeof roster === "number" ? roster : roster.length;
  const current = Array.isArray(roster) && roster.length >= 2 ? await prisma.deliveryEvaluation.findUnique({
    where: { key: deliveryLiveKey(roster) }, select: { id: true, status: true, cutoff: true, kind: true },
  }) : null;
  const currentActive = current?.status === "active" || current?.status === "failed" ? current : null;
  const active = live ? currentActive : official;
  const liveWaiting = live && cap >= 2 && current?.status !== "published" && current?.status !== "failed";
  const requested = !live && typeof evaluationId === "string" ? await prisma.deliveryEvaluation.findFirst({
    where: { id: evaluationId, kind: { in: kinds }, status: "published" }, select: { id: true, cutoff: true, kind: true },
  }) : null;
  const latest = live ? cap < 2 ? undefined : current?.status === "published" ? current : history[0] : requested ?? history[0];
  const evaluation = latest ? await prisma.deliveryEvaluation.findFirst({
    where: { id: latest.id, status: "published" }, select: { standings: true, entries: true,
      _count: { select: { matches: true } },
      matches: { orderBy: { ordinal: "asc" }, skip: (replayPage - 1) * DELIVERY_REPLAY_PAGE_SIZE, take: DELIVERY_REPLAY_PAGE_SIZE,
        select: { id: true, versionA: true, versionB: true, seed: true, flipped: true, rules: true } },
    },
  }) : null;
  const progress = active ? await prisma.deliveryMatch.groupBy({ by: ["status"], where: { evaluationId: active.id }, _count: true }) : [];
  return { history, active, bot, trials, cap, latest, evaluation, progress, live, liveWaiting, liveAvailable,
    limit: deliveryEntryLimit(), sampled: live && isSampledDelivery(cap),
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
    select: { id: true, status: true, versionA: true, versionB: true, result: true, seed: true, flipped: true, rules: true,
      evaluation: { select: { entries: true } } },
  });
  if (!match) return null;
  let result = match.result as unknown as (DeliveryResult & { reusedFrom?: string }) | null;
  const reused = Boolean(result?.reusedFrom);
  if (result?.reusedFrom) {
    const original = await prisma.deliveryMatch.findFirst({
      where: { id: result.reusedFrom, status: "completed", evaluation: { kind: "live", status: "published" },
        versionA: match.versionA, versionB: match.versionB, seed: match.seed, flipped: match.flipped, rules: match.rules },
      select: { result: true },
    });
    result = original?.result as unknown as DeliveryResult | null;
    if (!result?.frames) return null;
  }
  return { status: match.status, result, reused,
    names: match.evaluation ? [match.versionA, match.versionB].map(v =>
      (match.evaluation!.entries as ArenaEntry[]).find(e => e.versionId === v)?.name) : undefined };
}

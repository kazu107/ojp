import { randomBytes, randomUUID } from "node:crypto";
import type { DeliveryLadderEntry, Prisma } from "@prisma/client";
import { DELIVERY_OFFICIAL_MAPS, deliveryRulesForMap } from "./delivery-game";
import type { ArenaEntry } from "./delivery-evaluation";
import {
  DELIVERY_INITIAL_DEVIATION, DELIVERY_INITIAL_RATING, DELIVERY_LADDER_KINDS, DELIVERY_PLACEMENT_SETS,
  chooseLadderOpponent, estimateDeliverySkill, ladderOpponentTarget, ladderPlacementTarget, ladderSeatScore,
  type DeliveryLadderKind, type LadderScore,
} from "./delivery-ladder";
import { prisma } from "./db/prisma";

const CLOCK_ID = "delivery-ladder";
const INTAKE_DELAY_MS = 1500;
const FAILURE_COOLDOWN_MS = 60000;
const RECENT_LIMIT = 8;
const RANKED_PAGE = 30;
const ACTIVE = ["pending", "rated"];

function regularInterval() {
  const seconds = Number(process.env.DELIVERY_LADDER_INTERVAL_SECONDS);
  return (Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : 15) * 1000;
}

async function retireQueuedPair(tx: Prisma.TransactionClient, userId: string) {
  const evaluations = await tx.deliveryEvaluation.findMany({
    where: { kind: { in: [...DELIVERY_LADDER_KINDS] }, status: "active" }, select: { id: true, entries: true },
  });
  for (const evaluation of evaluations) {
    const entries = evaluation.entries as ArenaEntry[];
    if (!entries.some(entry => entry.userId === userId)) continue;
    await tx.deliveryEvaluation.update({ where: { id: evaluation.id }, data: { status: "superseded" } });
    // A running match keeps its lease; a queued match for an obsolete version need not run.
    await tx.deliveryMatch.updateMany({ where: { evaluationId: evaluation.id, status: "queued" }, data: { status: "cancelled" } });
    const other = entries.find(entry => entry.userId !== userId);
    if (other) {
      const row = await tx.deliveryLadderEntry.findUnique({ where: { userId: other.userId } });
      if (row?.activeVersionId === other.versionId) await tx.deliveryLadderEntry.update({
        where: { userId: other.userId }, data: { recentOpponentIds: recent(row, userId) },
      });
    }
  }
}

export async function enrollLadderVersion(tx: Prisma.TransactionClient, version: ArenaEntry, now: Date) {
  await retireQueuedPair(tx, version.userId);
  const previous = await tx.deliveryLadderEntry.findUnique({ where: { userId: version.userId },
    select: { dueAt: true, state: true, rankedVersionId: true, rankedRating: true, rankedDeviation: true } });
  const data = {
    activeVersionId: version.versionId, activeName: version.name, state: "pending",
    rating: previous?.rankedVersionId ? previous.rankedRating : DELIVERY_INITIAL_RATING,
    deviation: previous?.rankedVersionId ? Math.max(200, previous.rankedDeviation) : DELIVERY_INITIAL_DEVIATION,
    sets: 0, cleanGames: 0, recentOpponentIds: [],
    dueAt: previous?.state === "pending" ? previous.dueAt : now,
    availableAt: new Date(now.getTime() + INTAKE_DELAY_MS),
  };
  await tx.deliveryLadderEntry.upsert({ where: { userId: version.userId },
    create: { userId: version.userId, ...data }, update: data });
}

export async function withdrawLadderVersion(tx: Prisma.TransactionClient, userId: string) {
  await retireQueuedPair(tx, userId);
  await tx.deliveryLadderEntry.updateMany({ where: { userId },
    data: { activeVersionId: null, state: "withdrawn" } });
}

const dueOrder = [{ dueAt: "asc" }, { userId: "asc" }] as const;
const candidateFields = { userId: true, activeVersionId: true, activeName: true, rating: true, dueAt: true } as const;

async function opponentFor(tx: Prisma.TransactionClient, first: DeliveryLadderEntry, target: number, states: string[], now: Date, fresh: boolean) {
  const filter = {
    state: { in: states }, activeVersionId: { not: null }, availableAt: { lte: now },
    userId: { notIn: [first.userId, ...(fresh ? first.recentOpponentIds : [])] },
  };
  const [above, below, longestWaiting] = await Promise.all([
    tx.deliveryLadderEntry.findMany({ where: { ...filter, rating: { gte: target } },
      orderBy: [{ rating: "asc" }, ...dueOrder], take: 8, select: candidateFields }),
    tx.deliveryLadderEntry.findMany({ where: { ...filter, rating: { lt: target } },
      orderBy: [{ rating: "desc" }, ...dueOrder], take: 8, select: candidateFields }),
    tx.deliveryLadderEntry.findMany({ where: filter, orderBy: [...dueOrder], take: 4, select: candidateFields }),
  ]);
  const candidates = [...new Map([...above, ...below, ...longestWaiting].map(row => [row.userId, row])).values()];
  return chooseLadderOpponent(target, first.recentOpponentIds, candidates);
}

export async function scheduleLadderPair(tx: Prisma.TransactionClient, now = new Date()) {
  if (await tx.deliveryEvaluation.findFirst({
    where: { kind: { in: [...DELIVERY_LADDER_KINDS] }, status: "active" }, select: { id: true },
  })) return null;
  const clock = await tx.deliveryLadderClock.findUnique({ where: { id: CLOCK_ID } });
  const streak = clock?.placementStreak ?? 0;
  const sequence = clock?.ratedSequence ?? 0;
  const regularDue = !clock || clock.nextRatedAt <= now;
  const modes: DeliveryLadderKind[] = regularDue && streak >= 3
    ? ["ladder-rated", "ladder-placement"] : ["ladder-placement", ...(regularDue ? ["ladder-rated" as const] : [])];
  for (const kind of modes) {
    const placing = kind === "ladder-placement";
    const first = await tx.deliveryLadderEntry.findFirst({
      where: { state: placing ? "pending" : "rated", activeVersionId: { not: null }, availableAt: { lte: now } },
      orderBy: [...dueOrder],
    });
    if (!first?.activeVersionId) continue;
    const target = placing ? ladderPlacementTarget(first, first.sets) : ladderOpponentTarget(first.rating, sequence);
    const second = await opponentFor(tx, first, target, ["rated"], now, true) ??
      (placing ? await opponentFor(tx, first, target, ACTIVE, now, true) : null) ??
      await opponentFor(tx, first, target, ["rated"], now, false) ??
      (placing ? await opponentFor(tx, first, target, ACTIVE, now, false) : null);
    if (!second?.activeVersionId) continue;
    const entries = [
      { userId: first.userId, versionId: first.activeVersionId, name: first.activeName },
      { userId: second.userId, versionId: second.activeVersionId, name: second.activeName },
    ];
    const id = randomUUID(), seed = randomBytes(4).readUInt32BE(0) & 0x7fffffff;
    const map = DELIVERY_OFFICIAL_MAPS[(placing ? first.sets : sequence) % DELIVERY_OFFICIAL_MAPS.length];
    await tx.deliveryEvaluation.create({ data: { id, key: id, kind, status: "active", entries, cutoff: now, createdAt: now } });
    await tx.deliveryMatch.createMany({ data: [false, true].map((flipped, ordinal) => ({
      id: randomUUID(), evaluationId: id, ordinal, versionA: first.activeVersionId, versionB: second.activeVersionId,
      rules: deliveryRulesForMap(map), seed, flipped, status: "queued", createdAt: now,
    })) });
    const data = placing
      ? { placementStreak: Math.min(3, streak + 1), ratedSequence: sequence, nextRatedAt: clock?.nextRatedAt ?? now }
      : { placementStreak: 0, ratedSequence: (sequence + 1) % 240000, nextRatedAt: new Date(now.getTime() + regularInterval()) };
    await tx.deliveryLadderClock.upsert({ where: { id: CLOCK_ID }, create: { id: CLOCK_ID, ...data }, update: data });
    return id;
  }
  return null;
}

const recent = (row: DeliveryLadderEntry, opponentId: string) =>
  [...row.recentOpponentIds.filter(id => id !== opponentId), opponentId].slice(-RECENT_LIMIT);

export async function settleLadderPair(tx: Prisma.TransactionClient, id: string, kind: DeliveryLadderKind,
  entries: ArenaEntry[], games: LadderScore[] | null, now = new Date()) {
  const [a, b] = entries;
  if (!a || !b || a.userId === b.userId || entries.length !== 2) throw new Error("Invalid ladder pair");
  // The caller holds the arena lock and has checked the evaluation's active state.
  const rows = await tx.deliveryLadderEntry.findMany({ where: { userId: { in: [a.userId, b.userId] } } });
  const first = rows.find(row => row.userId === a.userId), second = rows.find(row => row.userId === b.userId);
  const placing = kind === "ladder-placement";
  const current = first?.activeVersionId === a.versionId && second?.activeVersionId === b.versionId &&
    first.state === (placing ? "pending" : "rated") && ACTIVE.includes(second.state) &&
    (placing || second.state === "rated");
  if (!current || !first || !second) {
    await tx.deliveryEvaluation.update({ where: { id }, data: { status: "superseded" } });
    return;
  }
  if (!games || games.length !== 2) {
    await tx.deliveryLadderEntry.updateMany({ where: { userId: { in: [a.userId, b.userId] } },
      data: { dueAt: now, availableAt: new Date(now.getTime() + FAILURE_COOLDOWN_MS) } });
    await tx.deliveryEvaluation.update({ where: { id }, data: { status: "failed" } });
    return;
  }
  for (const seat of [0, 1] as const) {
    if (placing && seat === 1) break; // Calibration does not change the opponent's rating.
    const [me, other] = seat === 0 ? [first, second] : [second, first];
    const result = estimateDeliverySkill(me, other, ladderSeatScore(games, seat), placing);
    const sets = me.sets + 1;
    const cleanGames = me.cleanGames + games.filter(game => !game.faults[seat]).length;
    const invalid = placing && (games.every(game => game.faults[seat] === "Bot compilation failed") ||
      (sets >= DELIVERY_PLACEMENT_SETS && cleanGames === 0));
    const rated = !invalid && (!placing || sets >= DELIVERY_PLACEMENT_SETS);
    await tx.deliveryLadderEntry.update({ where: { userId: me.userId }, data: {
      ...result, sets, cleanGames, state: invalid ? "invalid" : rated ? "rated" : "pending",
      recentOpponentIds: recent(me, other.userId), dueAt: now, availableAt: now,
      ...(rated ? { rankedVersionId: me.activeVersionId, rankedName: me.activeName, rankedRating: result.rating,
        rankedDeviation: result.deviation, rankedScore: result.rating - result.deviation, rankedSets: sets } : {}),
    } });
  }
  await tx.deliveryEvaluation.update({ where: { id }, data: { status: "published", publishedAt: now } });
}

export async function deliveryLadderOverview(userId?: string, requestedPage = 1) {
  const rankedFilter = { state: { in: ACTIVE }, rankedVersionId: { not: null } };
  const [count, eligible, rankedCount, me, bot, trials, pairs] = await Promise.all([
    prisma.deliveryLadderEntry.count({ where: { activeVersionId: { not: null } } }),
    prisma.deliveryLadderEntry.count({ where: { state: { in: ACTIVE } } }),
    prisma.deliveryLadderEntry.count({ where: rankedFilter }),
    userId ? prisma.deliveryLadderEntry.findUnique({ where: { userId }, select: { state: true, sets: true } }) : null,
    userId ? prisma.deliveryBotVersion.findFirst({ where: { userId, validUntil: null },
      select: { name: true, language: true, sourceCode: true } }) : null,
    userId ? prisma.deliveryMatch.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "desc" },
      take: 8, select: { id: true, status: true, createdAt: true } }) : [],
    prisma.deliveryEvaluation.findMany({ where: { kind: { in: [...DELIVERY_LADDER_KINDS] }, status: "published" },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: 12,
      select: { id: true, entries: true, kind: true, publishedAt: true, matches: {
        orderBy: { ordinal: "asc" }, select: { id: true, rules: true },
      } } }),
  ]);
  const pages = Math.max(1, Math.ceil(rankedCount / RANKED_PAGE));
  const page = Math.min(Math.max(requestedPage, 1), pages), offset = (page - 1) * RANKED_PAGE;
  const standings = await prisma.deliveryLadderEntry.findMany({ where: rankedFilter,
    orderBy: [{ rankedScore: "desc" }, { userId: "asc" }], skip: offset, take: RANKED_PAGE,
    select: { userId: true, rankedName: true, rankedRating: true, rankedDeviation: true, rankedScore: true, rankedSets: true, state: true } });
  const firstScore = standings[0]?.rankedScore;
  let rank = offset > 0 && firstScore !== undefined
    ? 1 + await prisma.deliveryLadderEntry.count({ where: { ...rankedFilter, rankedScore: { gt: firstScore } } }) : 1;
  const ranked = standings.map((row, i) => {
    if (i > 0 && standings[i - 1].rankedScore !== row.rankedScore) rank = offset + i + 1;
    return { ...row, rank };
  });
  return { count, eligible, me, bot, trials, pairs, standings: ranked, page, pages };
}

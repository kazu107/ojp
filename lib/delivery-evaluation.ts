import { createHash } from "node:crypto";
import { DELIVERY_RULES, DELIVERY_OFFICIAL_MAPS, deliveryRulesForMap, type DeliveryMap, type DeliveryResult } from "./delivery-game";
export type ArenaEntry = { userId: string; versionId: string; name: string };
export const DELIVERY_LIVE_SEEDS = [54832924];
export const DELIVERY_SAMPLE_OPPONENTS = 8;
export const isSampledDelivery = (size: number) => size >= 32;
export const liveMatchCount = (size: number) => size * (isSampledDelivery(size) ? DELIVERY_SAMPLE_OPPONENTS : Math.max(0, size - 1));
export function deliveryLiveKey(entries: ArenaEntry[]) {
  const digest = createHash("sha256").update(JSON.stringify([
    DELIVERY_RULES, DELIVERY_LIVE_SEEDS,
    entries.map(entry => entry.versionId).sort(),
    ...(isSampledDelivery(entries.length) ? ["sample-ring-v1"] : []),
  ])).digest("hex");
  return "live:" + digest;
}
export function weeklyDeliveryCutoff(now = new Date()) {
  const hour = 3600000, day = hour * 24;
  const jst = new Date(now.getTime() + hour * 9);
  const weekday = (jst.getUTCDay() + 6) % 7;
  let time = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - weekday, 3);
  if (time > jst.getTime()) time -= day * 7;
  return { key: "weekly:" + new Date(time).toISOString().slice(0, 10), cutoff: new Date(time - hour * 9) };
}
export function planDeliveryMatches(entries: ArenaEntry[], seeds: number[], options: { sampled?: boolean; official?: boolean } = {}) {
  const matches = [];
  const pairs: [number, number][] = [];
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      if (!options.sampled) pairs.push([a, b]);
    }
  }
  if (options.sampled) {
    if (!isSampledDelivery(entries.length)) throw new Error("Not enough entries for sampled pairing");
    // Hash user IDs, not versions: editing a bot keeps its balanced set of opponents.
    const ring = entries.map(({ userId }, i) => ({ i, token: createHash("sha256").update("delivery-ring:" + userId).digest("hex") }))
      .sort((a, b) => a.token.localeCompare(b.token) || a.i - b.i);
    for (let i = 0; i < ring.length; i++) {
      for (let offset = 1; offset <= DELIVERY_SAMPLE_OPPONENTS / 2; offset++) {
        const a = ring[i].i, b = ring[(i + offset) % ring.length].i;
        pairs.push(a < b ? [a, b] : [b, a]);
      }
    }
    pairs.sort(([a, b], [c, d]) => a - c || b - d);
  }
  for (const [a, b] of pairs) {
    for (const [i, seed] of seeds.entries()) {
      const map: DeliveryMap = options.official ? DELIVERY_OFFICIAL_MAPS[i] ?? "classic" : "classic";
      for (const flipped of [false, true])
        matches.push({ ordinal: matches.length, versionA: entries[a].versionId, versionB: entries[b].versionId,
          rules: deliveryRulesForMap(map), seed, flipped, status: "queued" });
    }
  }
  return matches;
}
export function rankDelivery(entries: ArenaEntry[], matches: {
  versionA: string; versionB: string; result: Pick<DeliveryResult, "winner" | "outcome" | "totals">;
}[]) {
  const rows = entries.map(entry => ({ ...entry, rank: 0, games: 0, points: 0, wins: 0, draws: 0, losses: 0, score: 0, conceded: 0 }));
  const byVersion = new Map(rows.map(r => [r.versionId, r]));
  for (const { versionA, versionB, result } of matches) {
    const players = [byVersion.get(versionA), byVersion.get(versionB)];
    for (const seat of [0, 1] as const) {
      const row = players[seat];
      if (!row) throw new Error("Match does not belong to this evaluation");
      row.games++;
      row.score += result.totals[seat];
      row.conceded += result.totals[1 - seat];
      if (result.winner === seat) { row.wins++; row.points += 3; }
      else if (result.winner === null && result.outcome === "score") { row.draws++; row.points++; }
      else row.losses++;
    }
  }
  rows.sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));
  rows.forEach((row, i) => { row.rank = i > 0 && rows[i - 1].points === row.points ? rows[i - 1].rank : i + 1; });
  return rows;
}
export type DeliveryStanding = ReturnType<typeof rankDelivery>[number];

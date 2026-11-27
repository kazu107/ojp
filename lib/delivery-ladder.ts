import type { DeliveryOutcome } from "./delivery-game";

export const DELIVERY_PLACEMENT_SETS = 6;
export const DELIVERY_INITIAL_RATING = 1500;
export const DELIVERY_INITIAL_DEVIATION = 320;
export const DELIVERY_LADDER_KINDS = ["ladder-placement", "ladder-rated"] as const;
export type DeliveryLadderKind = (typeof DELIVERY_LADDER_KINDS)[number];
export const isDeliveryLadderKind = (kind: string): kind is DeliveryLadderKind =>
  (DELIVERY_LADDER_KINDS as readonly string[]).includes(kind);
export const deliveryLadderEnabled = () => process.env.DELIVERY_ARENA_MODE !== "legacy";

export type LadderStats = { rating: number; deviation: number };
export type LadderScore = { winner: 0 | 1 | null; outcome: DeliveryOutcome; faults: [string | null, string | null] };
const clamp = (value: number, floor: number, ceil: number) => Math.min(ceil, Math.max(floor, value));

export function ladderSeatScore(games: LadderScore[], seat: 0 | 1) {
  return games.reduce((total, game) => total + (game.winner === seat ? 1 :
    game.winner === null && game.outcome === "score" ? 0.5 : 0), 0) / games.length;
}

export function estimateDeliverySkill(me: LadderStats, opponent: LadderStats, score: number, placing: boolean): LadderStats {
  const expected = 1 / (1 + 10 ** ((opponent.rating - me.rating) / 400));
  // A new version moves more quickly than an established rating.
  const k = placing ? Math.max(100, me.deviation * 1.45) : 28;
  const shrink = placing ? (score === 0.5 ? .86 : .8) : .97;
  return {
    rating: clamp(Math.round(me.rating + k * (score - expected)), 100, 3000),
    deviation: Math.max(60, Math.round(me.deviation * shrink)),
  };
}

export function ladderPlacementTarget(me: LadderStats, sets: number) {
  // Early sets follow the estimate; later, verify one matchup outside the estimated band.
  return clamp(me.rating + (sets === DELIVERY_PLACEMENT_SETS - 1 ? me.deviation * 2 : 0), 100, 3000);
}

export function ladderOpponentTarget(rating: number, ratedSequence: number) {
  const explore = ratedSequence % 4 === 3;
  return clamp(rating + (explore ? (ratedSequence % 8 === 3 ? 230 : -230) : 0), 100, 3000);
}

export type LadderCandidate = { userId: string; rating: number; dueAt: Date };
export function chooseLadderOpponent<T extends LadderCandidate>(target: number, recent: string[], pool: T[]) {
  return [...pool].sort((a, b) => {
    const rankRecent = (id: string) => recent.indexOf(id) + 1; // zero if not recently faced
    const distanceA = Math.abs(a.rating - target), distanceB = Math.abs(b.rating - target);
    return rankRecent(a.userId) - rankRecent(b.userId) ||
      Math.floor(distanceA / 120) - Math.floor(distanceB / 120) ||
      a.dueAt.getTime() - b.dueAt.getTime() || distanceA - distanceB || a.userId.localeCompare(b.userId);
  })[0] ?? null;
}

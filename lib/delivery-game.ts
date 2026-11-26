import type { BoardConfig, BoardReplay, BoardPiece } from "./board-visualization";

export const DELIVERY_RULES = "delivery-v1";
export const DELIVERY_TURNS = 100;
export const DELIVERY_CAPACITY = 2;
export const DELIVERY_DEFAULT_ENTRIES = 16;
export const DELIVERY_MAX_ENTRIES = 64;
export const DELIVERY_OFFICIAL_MAPS = ["short", "long", "bottleneck"] as const;
export type DeliveryMap = "classic" | (typeof DELIVERY_OFFICIAL_MAPS)[number];
export const deliveryMapLabels: Record<DeliveryMap, string> = {
  classic: "Classic city", short: "Short delivery city", long: "Long delivery city", bottleneck: "Bottleneck city",
};
export type DeliveryRules = typeof DELIVERY_RULES | `${typeof DELIVERY_RULES}-${Exclude<DeliveryMap, "classic">}`;
export function deliveryRulesForMap(map: DeliveryMap): DeliveryRules {
  return map === "classic" ? DELIVERY_RULES : `${DELIVERY_RULES}-${map}`;
}
export function deliveryMapForRules(rules: string): DeliveryMap | undefined {
  return rules === DELIVERY_RULES ? "classic" : DELIVERY_OFFICIAL_MAPS.find(map => deliveryRulesForMap(map) === rules);
}
const SIZE = 15;
type Seat = 0 | 1;
type Pair<T> = [T, T];
type Point = { x: number; y: number };
export type Order = { id: number; from: Point; to: Point; opens: number; deadline: number; base: number; size: number };
type State = "open" | "carried" | "delivered" | "expired";
type ActiveOrder = Order & { state: State; owner: Seat | null };
type Courier = Point & { score: number; delivered: number; penalty: number };
export type DeliveryAction =
  | { kind: "UP" | "DOWN" | "LEFT" | "RIGHT" | "WAIT" }
  | { kind: "PICKUP" | "DELIVER"; id: number };
export type DeliveryFrame = {
  turn: number;
  couriers: Pair<Courier>;
  actions: Pair<string>;
  active: [number, Seat | null][];
  events?: DeliveryEvent[];
};
export type DeliveryEvent =
  | { kind: "contested"; seat: Seat; orderId: number }
  | { kind: "delivered"; seat: Seat; orderId: number; base: number; bonus: number }
  | { kind: "expired"; seat: Seat | null; orderId: number; penalty: number };
export type DeliveryTiming = { queuedMs: number; prepareMs: number; compileMs: number; playMs: number; cacheHits: number };
export type DeliveryOutcome = "score" | "forfeit" | "double_forfeit";
export type DeliveryResult = {
  rules: DeliveryRules;
  seed: number;
  flipped: boolean;
  board: string[];
  orders: Order[];
  frames: DeliveryFrame[];
  winner: Seat | null;
  outcome: DeliveryOutcome;
  faults: Pair<string | null>;
  totals: Pair<number>;
  timing?: DeliveryTiming;
};

const moves = {
  UP: { x: 0, y: -1 }, DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 }, RIGHT: { x: 1, y: 0 },
} as const;
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const add = (a: Point, b: Point) => ({ x: a.x + b.x, y: a.y + b.y });
const key = (p: Point) => p.y * SIZE + p.x;
const walkable = (board: string[], p: Point) => p.x > 0 && p.x < SIZE - 1 &&
  p.y > 0 && p.y < SIZE - 1 && board[p.y][p.x] !== "#";

export function parseDeliveryAction(line: string): DeliveryAction | null {
  if (/^(UP|DOWN|LEFT|RIGHT|WAIT)$/.test(line)) return { kind: line as "UP" | "DOWN" | "LEFT" | "RIGHT" | "WAIT" };
  const match = /^(PICKUP|DELIVER) ([1-9]\d{0,2})$/.exec(line);
  return match ? { kind: match[1] as "PICKUP" | "DELIVER", id: Number(match[2]) } : null;
}

function paths(board: string[], start: Point) {
  const found = new Map<number, { distance: number; first: keyof typeof moves | "WAIT" }>();
  found.set(key(start), { distance: 0, first: "WAIT" });
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i], current = found.get(key(p))!;
    for (const [kind, offset] of Object.entries(moves) as [keyof typeof moves, Point][]) {
      const next = add(p, offset);
      if (!walkable(board, next) || found.has(key(next))) continue;
      found.set(key(next), { distance: current.distance + 1, first: current.distance ? current.first : kind });
      queue.push(next);
    }
  }
  return found;
}

function scenario(seed: number, map: DeliveryMap = "classic") {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Invalid delivery seed");
  let state = seed >>> 0;
  const random = (limit: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * limit);
  };
  const board = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => {
    if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) return "#";
    if (map === "bottleneck") {
      if (y === 7 && x >= 5 && x <= 9) return ".";
      if (x === 7) return "#";
    }
    // A ring and a lattice of connected streets remain open in every seed.
    return x % 4 >= 2 && y % 4 >= 2 && random(4) !== 0 ? "#" : ".";
  }).join(""));
  const depots: Point[] = [{ x: 1, y: 5 }, { x: 5, y: 1 }, { x: 9, y: 13 }, { x: 13, y: 9 }, { x: 5, y: 5 }, { x: 9, y: 9 }];
  const starts: Pair<Point> = [{ x: 1, y: 1 }, { x: 13, y: 13 }];
  const allowed = paths(board, starts[0]);
  const destinations = [...allowed.keys()].map(n => ({ x: n % SIZE, y: Math.floor(n / SIZE) }));
  const depotPaths = depots.map(p => paths(board, p));
  const orders = Array.from({ length: 30 }, (_, i): Order => {
    const index = i === 0 ? 0 : i === 1 ? 3 : random(depots.length);
    const from = depots[index];
    const opens = i < 4 ? 1 : 3 + (i - 3) * 3;
    const reachable = destinations.filter(p => {
      const distance = depotPaths[index].get(key(p))?.distance ?? 0;
      if (distance < 4) return false;
      if (map === "classic") return true;
      if (distance > DELIVERY_TURNS - opens - 1) return false;
      if (map === "short") return distance <= 9;
      if (map === "long") return distance >= 12;
      return (p.x < 7) !== (from.x < 7);
    });
    const to = reachable[random(reachable.length)];
    const distance = depotPaths[index].get(key(to))!.distance;
    const size = random(4) === 0 ? 2 : 1;
    return { id: i + 1, from, to, opens, size, base: 35 + (size - 1) * 20 + 3 * distance,
      deadline: Math.min(DELIVERY_TURNS, opens + distance + 10 + random(13)) };
  });
  return { board, starts, orders, priority: random(2) as Seat };
}

export function deliveryReward(base: number, deadline: number, turn: number) {
  return base + Math.min(20, (deadline - turn) * 2);
}

export class DeliveryGame {
  readonly board: string[];
  readonly orders: ActiveOrder[];
  readonly couriers: Pair<Courier>;
  readonly frames: DeliveryFrame[] = [];
  readonly firstPriority: Seat;
  turn = 1;

  constructor(readonly seed: number, readonly flipped = false, input?: ReturnType<typeof scenario>,
    readonly map: DeliveryMap = "classic") {
    input ??= scenario(seed, map);
    this.board = input.board;
    this.orders = input.orders.map(o => ({ ...o, state: "open", owner: null }));
    const courier = (p: Point): Courier => ({ ...p, score: 0, delivered: 0, penalty: 0 });
    this.couriers = flipped ? [courier(input.starts[1]), courier(input.starts[0])] : input.starts.map(courier) as Pair<Courier>;
    this.firstPriority = ((input.priority + Number(flipped)) % 2) as Seat;
    this.capture(0, ["WAIT", "WAIT"]);
  }
  get done() { return this.turn > DELIVERY_TURNS; }
  active() {
    return this.orders.filter(o => o.opens <= this.turn && (o.state === "open" || o.state === "carried"));
  }
  load(seat: Seat) {
    return this.orders.reduce((n, o) => n + (o.state === "carried" && o.owner === seat ? o.size : 0), 0);
  }
  private capture(turn: number, actions: Pair<string>, events: DeliveryEvent[] = []) {
    this.frames.push({
      turn, actions,
      couriers: [{ ...this.couriers[0] }, { ...this.couriers[1] }],
      active: this.active().map(o => [o.id, o.owner]),
      ...(events.length ? { events } : {}),
    });
  }
  observe(seat: Seat): string {
    const me = this.couriers[seat], opponent = this.couriers[1 - seat], orders = this.active();
    return [
      [this.turn, seat, SIZE, SIZE, me.x, me.y, opponent.x, opponent.y, this.load(seat),
        this.couriers[0].score, this.couriers[1].score, orders.length].join(" "),
      ...this.board,
      ...orders.map(o => [o.id, o.from.x, o.from.y, o.to.x, o.to.y, o.deadline, o.base, o.size, o.owner ?? -1].join(" ")),
    ].join("\n") + "\n";
  }
  step(actions: Pair<DeliveryAction>) {
    if (this.done) throw new Error("Delivery match has ended");
    const priority = ((this.firstPriority + this.turn - 1) % 2) as Seat;
    const applied: Pair<string> = ["WAIT", "WAIT"];
    const events: DeliveryEvent[] = [];
    const [a, b] = actions;
    if (a.kind === "PICKUP" && b.kind === "PICKUP" && a.id === b.id) {
      const order = this.orders.find(o => o.id === a.id && o.opens <= this.turn && o.state === "open");
      if (order && ([0, 1] as const).every(s => same(this.couriers[s], order.from) &&
          this.load(s) + order.size <= DELIVERY_CAPACITY)) events.push({ kind: "contested", seat: priority, orderId: order.id });
    }
    for (const seat of [priority, (1 - priority) as Seat]) {
      const a = actions[seat], p = this.couriers[seat];
      if (a.kind === "PICKUP" || a.kind === "DELIVER") {
        const order = this.orders.find(o => o.id === a.id && o.opens <= this.turn);
        if (!order) continue;
        if (a.kind === "PICKUP" && order.state === "open" && same(p, order.from) &&
            this.load(seat) + order.size <= DELIVERY_CAPACITY) {
          order.state = "carried"; order.owner = seat; applied[seat] = "PICKUP " + a.id;
        } else if (a.kind === "DELIVER" && order.state === "carried" && order.owner === seat && same(p, order.to)) {
          order.state = "delivered";
          const points = deliveryReward(order.base, order.deadline, this.turn);
          p.score += points;
          events.push({ kind: "delivered", seat, orderId: order.id, base: order.base, bonus: points - order.base });
          p.delivered++; applied[seat] = "DELIVER " + a.id;
        }
      } else if (a.kind !== "WAIT") {
        const next = add(p, moves[a.kind]);
        if (walkable(this.board, next)) {
          p.x = next.x; p.y = next.y; applied[seat] = a.kind;
        }
      }
    }
    for (const o of this.orders) {
      if (o.deadline !== this.turn || (o.state !== "open" && o.state !== "carried")) continue;
      if (o.state === "carried" && o.owner !== null) {
        this.couriers[o.owner].score -= o.base;
        this.couriers[o.owner].penalty += o.base;
      }
      events.push({ kind: "expired", seat: o.owner, orderId: o.id, penalty: o.owner === null ? 0 : o.base });
      o.state = "expired";
    }
    this.turn++;
    this.capture(this.turn - 1, applied, events);
  }
  result(faults: Pair<string | null> = [null, null]): DeliveryResult {
    const totals: Pair<number> = [this.couriers[0].score, this.couriers[1].score];
    const both = !!faults[0] && !!faults[1];
    return {
      rules: deliveryRulesForMap(this.map), seed: this.seed, flipped: this.flipped, board: this.board,
      orders: this.orders.map(({ id, from, to, opens, deadline, base, size }) =>
        ({ id, from, to, opens, deadline, base, size })),
      frames: this.frames, totals, faults,
      outcome: both ? "double_forfeit" : faults.some(Boolean) ? "forfeit" : "score",
      winner: both ? null : faults[0] ? 1 : faults[1] ? 0 : totals[0] === totals[1] ? null : totals[0] > totals[1] ? 0 : 1,
    };
  }
}

export function standardDeliveryAction(game: DeliveryGame, seat: Seat): DeliveryAction {
  const me = game.couriers[seat], routes = paths(game.board, me);
  const held = game.active().filter(o => o.owner === seat)
    .sort((a, b) => a.deadline - b.deadline || a.id - b.id)[0];
  if (held) {
    return same(me, held.to) ? { kind: "DELIVER", id: held.id } : { kind: routes.get(key(held.to))?.first ?? "WAIT" };
  }
  const options = game.active().filter(o => o.state === "open").flatMap(o => {
    const pickup = routes.get(key(o.from));
    const trip = paths(game.board, o.from).get(key(o.to));
    if (!pickup || !trip) return [];
    const cost = pickup.distance + trip.distance + 2;
    return game.turn + cost - 1 <= o.deadline ? [{ o, pickup, cost }] : [];
  }).sort((a, b) => b.o.base * a.cost - a.o.base * b.cost || a.o.id - b.o.id);
  const next = options[0];
  return !next ? { kind: "WAIT" } : same(me, next.o.from) ? { kind: "PICKUP", id: next.o.id } : { kind: next.pickup.first };
}

export const deliveryBoard: BoardConfig = {
  version: 1, coordinates: true, trail: false, wallSymbols: "#", playerSymbol: "S", goalSymbol: "G", itemSymbol: "o",
  symbols: [
    { symbol: "#", label: "Wall", color: "#294052", glyph: "", shape: "tile" },
    { symbol: ".", label: "Road", color: "#142533", glyph: "", shape: "tile" },
  ],
};
export function deliveryBoardReplay(result: DeliveryResult): BoardReplay {
  const orders = new Map(result.orders.map(o => [o.id, o]));
  const colors = ["#f3a45d", "#62cbea"] as const;
  return {
    version: 1, board: result.board,
    frames: result.frames.map((f) => {
      const open = f.active.flatMap(([id, seat]): BoardPiece[] => {
        const order = orders.get(id);
        if (!order) return [];
        return [{ ...(seat === null ? order.from : order.to), id: "order-" + id,
          glyph: seat === null ? String(id) : "D", shape: "diamond", color: seat === null ? "#72c591" : colors[seat] }];
      });
      const p = f.couriers;
      const couriers: BoardPiece[] = same(p[0], p[1])
        ? [{ ...p[0], id: "both", glyph: "AB", shape: "circle", color: "#fde28a" }]
        : p.map((c, i) => ({ ...c, id: "courier-" + i, glyph: i === 0 ? "A" : "B", shape: "circle", color: colors[i] }));
      return { turn: f.turn, cleared: [], paths: [], pieces: [...open, ...couriers],
        label: `${f.turn}: A ${f.couriers[0].score} | B ${f.couriers[1].score}` };
    }),
  };
}

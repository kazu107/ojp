export interface BoardSymbol {
  symbol: string;
  label: string;
  color: string;
  glyph: string;
  shape: "tile" | "circle" | "diamond";
}
export interface BoardConfig {
  version: 1;
  coordinates: boolean;
  trail: boolean;
  wallSymbols: string;
  playerSymbol: string;
  goalSymbol: string;
  itemSymbol: string;
  symbols: BoardSymbol[];
}
export interface GridGameConfig {
  version: 1;
  objective: "maze" | "treasure";
  protocol: "moves" | "turns";
  maxTurns: number;
  turnTimeLimitMs: number;
  firstTurnTimeLimitMs: number;
}
export interface BoardPoint {
  x: number;
  y: number;
}
export interface BoardPiece extends BoardPoint {
  id: string;
  glyph: string;
  color: string;
  shape: "circle" | "diamond" | "tile";
}
export interface BoardFrame {
  turn: number;
  label: string;
  pieces: BoardPiece[];
  cleared: BoardPoint[];
  board?: string[];
  paths?: BoardPoint[][];
}
export interface BoardReplay {
  version: 1;
  board: string[];
  frames: BoardFrame[];
  score?: string | null;
  success?: boolean;
  message?: string;
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  version: 1,
  coordinates: true,
  trail: true,
  wallSymbols: "#",
  playerSymbol: "S",
  goalSymbol: "G",
  itemSymbol: "o",
  symbols: [
    { symbol: "#", label: "Wall", color: "#35465d", glyph: "", shape: "tile" },
    { symbol: ".", label: "Floor", color: "#142334", glyph: "", shape: "tile" },
    {
      symbol: "S",
      label: "Player",
      color: "#f3a45d",
      glyph: "R",
      shape: "circle",
    },
    { symbol: "G", label: "Goal", color: "#53cda2", glyph: "G", shape: "tile" },
    {
      symbol: "o",
      label: "Treasure",
      color: "#eed179",
      glyph: "+",
      shape: "diamond",
    },
  ],
};
export const DEFAULT_GRID_GAME: GridGameConfig = {
  version: 1,
  objective: "maze",
  protocol: "turns",
  maxTurns: 200,
  turnTimeLimitMs: 1000,
  firstTurnTimeLimitMs: 3000,
};
export const BOARD_EXAMPLE_INPUT =
  "5 8\n########\n#S..o.G#\n#.#.#..#\n#......#\n########\n";
export const BOARD_EXAMPLE_OUTPUT = "RIGHT RIGHT RIGHT RIGHT RIGHT\n";

export function isWellFormedText(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
      return false;
  }
  return true;
}

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid board configuration");
  return raw as Record<string, unknown>;
}
function text(raw: unknown, max: number) {
  if (
    typeof raw !== "string" ||
    raw.length > max ||
    /[\u0000-\u001f\u007f]/.test(raw) ||
    !isWellFormedText(raw)
  )
    throw new Error("Invalid board text");
  return raw;
}
function symbol(raw: unknown) {
  const s = text(raw, 2);
  if (Array.from(s).length !== 1 || /\s/.test(s))
    throw new Error("Use one visible character per board symbol");
  return s;
}
function color(raw: unknown) {
  const s = text(raw, 7);
  if (!/^#[0-9a-f]{6}$/i.test(s)) throw new Error("Use a six-digit hex color");
  return s;
}
function integer(raw: unknown, min: number, max: number) {
  if (!Number.isSafeInteger(raw) || Number(raw) < min || Number(raw) > max)
    throw new Error("Board value exceeds limit");
  return Number(raw);
}

export function parseBoardConfig(raw: unknown): BoardConfig {
  const value = object(raw);
  if (value.version !== 1) throw new Error("Unsupported board format version");
  if (
    !Array.isArray(value.symbols) ||
    !value.symbols.length ||
    value.symbols.length > 32
  )
    throw new Error("Define between 1 and 32 board symbols");
  const symbols = value.symbols.map((item) => {
    const s = object(item);
    if (!["tile", "circle", "diamond"].includes(String(s.shape)))
      throw new Error("Invalid board shape");
    return {
      symbol: symbol(s.symbol),
      label: text(s.label, 60),
      color: color(s.color),
      glyph: text(s.glyph ?? "", 8),
      shape: s.shape as BoardSymbol["shape"],
    };
  });
  if (new Set(symbols.map((s) => s.symbol)).size !== symbols.length)
    throw new Error("Duplicate board symbol");
  for (const key of ["coordinates", "trail"] as const)
    if (value[key] !== undefined && typeof value[key] !== "boolean")
      throw new Error("Invalid board option");
  const wallSymbols = text(value.wallSymbols ?? "#", 16);
  if (!wallSymbols || /\s/.test(wallSymbols))
    throw new Error("Invalid wall symbols");
  const playerSymbol = symbol(value.playerSymbol ?? "S"),
    goalSymbol = symbol(value.goalSymbol ?? "G"),
    itemSymbol = symbol(value.itemSymbol ?? "o");
  if (
    new Set([".", playerSymbol, goalSymbol, itemSymbol]).size !== 4 ||
    [".", playerSymbol, goalSymbol, itemSymbol].some((s) =>
      wallSymbols.includes(s),
    )
  )
    throw new Error("Floor, player, goal, item and wall symbols must differ");
  return {
    version: 1,
    symbols,
    coordinates: value.coordinates !== false,
    trail: value.trail !== false,
    wallSymbols,
    playerSymbol,
    goalSymbol,
    itemSymbol,
  };
}
export function parseGridGameConfig(raw: unknown): GridGameConfig {
  const value = object(raw);
  if (value.version !== undefined && value.version !== 1)
    throw new Error("Unsupported game rules version");
  if (
    !["maze", "treasure"].includes(String(value.objective)) ||
    !["moves", "turns"].includes(String(value.protocol))
  )
    throw new Error("Invalid grid game mode");
  return {
    version: 1,
    objective: value.objective as GridGameConfig["objective"],
    protocol: value.protocol as GridGameConfig["protocol"],
    maxTurns: integer(value.maxTurns ?? 200, 1, 500),
    turnTimeLimitMs: integer(value.turnTimeLimitMs ?? 1000, 100, 5000),
    firstTurnTimeLimitMs: integer(
      value.firstTurnTimeLimitMs ?? 3000,
      100,
      10000,
    ),
  };
}
export function parseBoardInput(input: string): string[] {
  if (!isWellFormedText(input)) throw new Error("Invalid board text");
  if (input.length > 8192) throw new Error("Board input is limited to 8 KiB");
  const lines = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trimEnd()
    .split("\n");
  const dimensions = lines
    .shift()
    ?.trim()
    .match(/^(\d+)\s+(\d+)$/);
  if (!dimensions) throw new Error("Start board input with rows and columns");
  const rows = integer(Number(dimensions[1]), 1, 32),
    columns = integer(Number(dimensions[2]), 1, 32);
  if (
    lines.length !== rows ||
    lines.some(
      (line) =>
        Array.from(line).length !== columns ||
        /[\u0000-\u0020\u007f]/.test(line),
    )
  )
    throw new Error("Board dimensions do not match the grid");
  return lines;
}
export function parseBoardReplay(
  input: string,
  output: string,
  config: BoardConfig,
  game?: GridGameConfig,
): BoardReplay {
  const board = parseBoardInput(input);
  if (output.length > 262144)
    throw new Error("Replay output is limited to 256 KiB");
  if (!output.trim())
    return {
      version: 1,
      board,
      frames: [{ turn: 0, label: "", pieces: [], cleared: [] }],
    };
  if (!output.trim().startsWith("{"))
    return simulateGridGame(
      input,
      output,
      config,
      game ?? { ...DEFAULT_GRID_GAME, protocol: "moves" },
    );
  const value = object(JSON.parse(output));
  if (
    !Array.isArray(value.frames) ||
    !value.frames.length ||
    value.frames.length > 501
  )
    throw new Error("Define between 1 and 501 replay frames");
  const width = Array.from(board[0]).length,
    height = board.length;
  let elements = 0;
  const point = (raw: unknown): BoardPoint => {
    const p = object(raw);
    return { x: integer(p.x, 0, width - 1), y: integer(p.y, 0, height - 1) };
  };
  const frames = value.frames.map((raw, turn): BoardFrame => {
    const frame = object(raw);
    if (
      !Array.isArray(frame.pieces ?? []) ||
      ((frame.pieces as unknown[]) ?? []).length > 128 ||
      !Array.isArray(frame.cleared ?? []) ||
      !Array.isArray(frame.paths ?? [])
    )
      throw new Error("Invalid replay frame");
    const pieces = ((frame.pieces ?? []) as unknown[]).map(
      (raw): BoardPiece => {
        const p = object(raw);
        return {
          ...point(p),
          id: text(p.id, 40),
          glyph: text(p.glyph ?? "", 8),
          color: color(p.color ?? "#f3a45d"),
          shape: ["tile", "circle", "diamond"].includes(String(p.shape))
            ? (p.shape as BoardPiece["shape"])
            : "circle",
        };
      },
    );
    if (new Set(pieces.map((p) => p.id)).size !== pieces.length)
      throw new Error("Duplicate replay piece ID");
    const cleared = ((frame.cleared ?? []) as unknown[]).map(point);
    const paths = ((frame.paths ?? []) as unknown[]).map((path) => {
      if (!Array.isArray(path)) throw new Error("Invalid replay path");
      return path.map(point);
    });
    let grid: string[] | undefined;
    if (frame.board !== undefined) {
      if (
        !Array.isArray(frame.board) ||
        frame.board.some((row) => typeof row !== "string")
      )
        throw new Error("Invalid frame board");
      grid = parseBoardInput(`${height} ${width}\n${frame.board.join("\n")}`);
    }
    elements +=
      pieces.length +
      cleared.length +
      paths.reduce((sum, path) => sum + path.length, 0) +
      (grid ? width * height : 0);
    if (elements > 65536) throw new Error("Replay element limit exceeded");
    return {
      turn,
      label: text(frame.label ?? "", 100),
      pieces,
      cleared,
      paths,
      ...(grid ? { board: grid } : {}),
    };
  });
  return { version: 1, board, frames };
}

export class GridGame {
  readonly board: string[];
  readonly frames: BoardFrame[] = [];
  readonly remaining = new Set<string>();
  x = 0;
  y = 0;
  turn = 0;
  collected = 0;
  finished = false;
  success = false;
  message = "";
  constructor(
    input: string,
    readonly config: BoardConfig,
    readonly rules: GridGameConfig,
  ) {
    const rows = parseBoardInput(input).map((row) => Array.from(row));
    let players = 0,
      goals = 0;
    rows.forEach((row, y) =>
      row.forEach((cell, x) => {
        if (cell === config.playerSymbol) {
          this.x = x;
          this.y = y;
          players++;
          row[x] = ".";
        }
        if (cell === config.goalSymbol) goals++;
        if (cell === config.itemSymbol) this.remaining.add(`${x},${y}`);
      }),
    );
    if (players !== 1 || goals < 1)
      throw new Error("A game board requires one player and at least one goal");
    this.board = rows.map((row) => row.join(""));
    this.snapshot("");
  }
  private snapshot(action: string, cleared: BoardPoint[] = []) {
    const style = this.config.symbols.find(
      (s) => s.symbol === this.config.playerSymbol,
    );
    this.frames.push({
      turn: this.turn,
      label: action,
      cleared,
      pieces: [
        {
          id: "player",
          x: this.x,
          y: this.y,
          glyph: style?.glyph ?? "R",
          color: style?.color ?? "#f3a45d",
          shape: style?.shape ?? "circle",
        },
      ],
    });
  }
  observation() {
    return {
      version: 1,
      turn: this.turn,
      maxTurns: this.rules.maxTurns,
      board: this.board.map((row, y) =>
        Array.from(row)
          .map((cell, x) =>
            cell === this.config.itemSymbol && !this.remaining.has(`${x},${y}`)
              ? "."
              : cell,
          )
          .join(""),
      ),
      player: { x: this.x, y: this.y },
      items: [...this.remaining].map((key) => {
        const [x, y] = key.split(",").map(Number);
        return { x, y };
      }),
      done: this.finished,
    };
  }
  step(raw: string) {
    if (this.finished) throw new Error("Game already ended");
    const action = raw.trim().toUpperCase();
    const moves: Record<string, [number, number]> = {
      UP: [0, -1],
      DOWN: [0, 1],
      LEFT: [-1, 0],
      RIGHT: [1, 0],
      WAIT: [0, 0],
      STOP: [0, 0],
    };
    if (!Object.hasOwn(moves, action)) {
      this.finish("Unknown game action");
      return;
    }
    this.turn++;
    if (action === "STOP") {
      this.finish("Stopped before reaching the goal");
      this.snapshot(action);
      return;
    }
    const [dx, dy] = moves[action],
      x = this.x + dx,
      y = this.y + dy;
    const cell =
      this.board[y] === undefined ? undefined : Array.from(this.board[y])[x];
    if (cell === undefined || this.config.wallSymbols.includes(cell)) {
      this.finish("Move hits a wall or leaves the board");
      this.snapshot(action);
      return;
    }
    this.x = x;
    this.y = y;
    const collected = this.remaining.delete(`${x},${y}`);
    if (collected) this.collected++;
    if (cell === this.config.goalSymbol) {
      this.finished = true;
      this.success = true;
      this.message = "Goal reached";
    } else if (this.turn >= this.rules.maxTurns)
      this.finish("Turn limit reached");
    this.snapshot(action, collected ? [{ x, y }] : []);
  }
  finish(message = "Output ended before reaching the goal") {
    this.finished = true;
    this.message = message;
  }
  replay(): BoardReplay {
    return {
      version: 1,
      board: this.board,
      frames: this.frames,
      score: this.success
        ? String(
            100000 +
              (this.rules.objective === "treasure"
                ? this.collected * 1000
                : 0) +
              this.rules.maxTurns -
              this.turn,
          )
        : null,
      success: this.success,
      message: this.message,
    };
  }
}
export function gridGameObservationText(game: GridGame) {
  const state = game.observation();
  return state.done
    ? "END\n"
    : `${state.board.length} ${Array.from(state.board[0]).length} ${state.turn} ${state.maxTurns} ${state.player.x} ${state.player.y}\n${state.board.join("\n")}\n`;
}
export function simulateGridGame(
  input: string,
  output: string,
  config: BoardConfig,
  rules: GridGameConfig,
): BoardReplay {
  if (output.length > 262144)
    throw new Error("Replay output is limited to 256 KiB");
  const game = new GridGame(input, config, rules);
  const tokens = output.trim() ? output.trim().split(/\s+/) : [];
  if (tokens.length > 500) throw new Error("Game action limit exceeded");
  for (const action of tokens) {
    if (game.finished) break;
    game.step(action);
  }
  if (!game.finished) game.finish();
  return game.replay();
}

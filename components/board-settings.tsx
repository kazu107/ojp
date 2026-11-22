"use client";
import {
  DEFAULT_BOARD_CONFIG,
  DEFAULT_GRID_GAME,
  BOARD_EXAMPLE_INPUT,
  BOARD_EXAMPLE_OUTPUT,
  type BoardConfig,
} from "@/lib/board-visualization";
import type { HeuristicConfig } from "@/lib/heuristic-config";
import { useI18n } from "./i18n-provider";
import { BoardVisualizer } from "./board-visualizer";

export function BoardSettings({
  value,
  onChange,
  sampleInput,
  sampleOutput,
  onUseSample,
}: {
  value: HeuristicConfig;
  onChange: (value: HeuristicConfig) => void;
  sampleInput?: string;
  sampleOutput?: string;
  onUseSample?: (input: string, output: string) => void;
}) {
  const { t } = useI18n(),
    board = value.board ?? DEFAULT_BOARD_CONFIG;
  const patch = (next: Partial<BoardConfig>) =>
    onChange({ ...value, board: { ...board, ...next } });
  return (
    <section className="stack board-settings">
      <h4>{t("Board and game settings")}</h4>
      <p className="text-soft">
        {t(
          "Define a grid with symbols, pieces and paths. No uploaded JavaScript is executed by the viewer.",
        )}
      </p>
      <label className="filter-checkbox">
        <input
          type="checkbox"
          checked={!!value.game}
          onChange={(e) =>
            onChange({
              ...value,
              game: e.target.checked ? { ...DEFAULT_GRID_GAME } : undefined,
              direction: e.target.checked ? "maximize" : value.direction,
            })
          }
        />
        {t("Enable built-in grid game")}
      </label>
      {value.game ? (
        <>
          <p className="text-soft">
            {t(
              "Game judging uses the built-in referee, not the checker source. An isolated worker is required for server execution.",
            )}
          </p>
          <div className="form-grid">
            <label className="field">
              {t("Game objective")}
              <select
                className="select"
                value={value.game.objective}
                onChange={(e) =>
                  onChange({
                    ...value,
                    game: {
                      ...value.game!,
                      objective: e.target.value as "maze" | "treasure",
                    },
                  })
                }
              >
                <option value="maze">{t("Maze robot")}</option>
                <option value="treasure">{t("Treasure collector")}</option>
              </select>
            </label>
            <label className="field">
              {t("Game protocol")}
              <select
                className="select"
                value={value.game.protocol}
                onChange={(e) =>
                  onChange({
                    ...value,
                    game: {
                      ...value.game!,
                      protocol: e.target.value as "moves" | "turns",
                    },
                  })
                }
              >
                <option value="turns">{t("One action per observation")}</option>
                <option value="moves">{t("Output all actions")}</option>
              </select>
            </label>
            {(
              [
                ["maxTurns", "Maximum turns", 1, 500],
                ["turnTimeLimitMs", "Turn timeout (ms)", 100, 5000],
                ["firstTurnTimeLimitMs", "First turn timeout (ms)", 100, 10000],
              ] as const
            ).map(([key, label, min, max]) => (
              <label className="field" key={key}>
                {t(label)}
                <input
                  className="input"
                  type="number"
                  min={min}
                  max={max}
                  value={value.game![key]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      game: { ...value.game!, [key]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </>
      ) : null}
      <div className="form-grid">
        {(
          [
            ["wallSymbols", "Wall symbols"],
            ["playerSymbol", "Player symbol"],
            ["goalSymbol", "Goal symbol"],
            ["itemSymbol", "Item symbol"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="field">
            {t(label)}
            <input
              className="input"
              maxLength={key === "wallSymbols" ? 16 : 2}
              value={board[key]}
              onChange={(e) => patch({ [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="button-row">
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={board.coordinates}
            onChange={(e) => patch({ coordinates: e.target.checked })}
          />
          {t("Show coordinates")}
        </label>
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={board.trail}
            onChange={(e) => patch({ trail: e.target.checked })}
          />
          {t("Show movement trail")}
        </label>
      </div>
      <div className="stack">
        {board.symbols.map((symbol, index) => (
          <div className="board-symbol-row" key={index}>
            <label className="field">
              {t("Symbol")}
              <input
                className="input"
                maxLength={2}
                value={symbol.symbol}
                onChange={(e) =>
                  patch({
                    symbols: board.symbols.map((s, i) =>
                      i === index ? { ...s, symbol: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              {t("Label")}
              <input
                className="input"
                maxLength={60}
                value={symbol.label}
                onChange={(e) =>
                  patch({
                    symbols: board.symbols.map((s, i) =>
                      i === index ? { ...s, label: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              {t("Color")}
              <input
                className="input board-color"
                type="color"
                value={
                  /^#[0-9a-f]{6}$/i.test(symbol.color)
                    ? symbol.color
                    : "#000000"
                }
                onChange={(e) =>
                  patch({
                    symbols: board.symbols.map((s, i) =>
                      i === index ? { ...s, color: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              {t("Hex color")}
              <input
                className="input code-block"
                type="text"
                maxLength={7}
                pattern="#[0-9a-fA-F]{6}"
                value={symbol.color}
                onChange={(e) =>
                  patch({
                    symbols: board.symbols.map((s, i) =>
                      i === index ? { ...s, color: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              {t("Glyph")}
              <input
                className="input"
                maxLength={8}
                value={symbol.glyph}
                onChange={(e) =>
                  patch({
                    symbols: board.symbols.map((s, i) =>
                      i === index ? { ...s, glyph: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              {t("Shape")}
              <select
                className="select"
                value={symbol.shape}
                onChange={(e) =>
                  patch({
                    symbols: board.symbols.map((s, i) =>
                      i === index
                        ? { ...s, shape: e.target.value as typeof s.shape }
                        : s,
                    ),
                  })
                }
              >
                <option value="tile">{t("Tile")}</option>
                <option value="circle">{t("Circle")}</option>
                <option value="diamond">{t("Diamond")}</option>
              </select>
            </label>
            <button
              className="button button-secondary"
              type="button"
              disabled={board.symbols.length === 1}
              onClick={() =>
                patch({ symbols: board.symbols.filter((_, i) => i !== index) })
              }
            >
              {t("Remove symbol")}
            </button>
          </div>
        ))}
      </div>
      <div className="button-row">
        <button
          className="button button-secondary"
          type="button"
          disabled={board.symbols.length >= 32}
          onClick={() => {
            const next = Array.from(
              "abcdefghijklmnopqrstuvwxyz0123456789",
            ).find((c) => !board.symbols.some((s) => s.symbol === c));
            if (next)
              patch({
                symbols: [
                  ...board.symbols,
                  {
                    symbol: next,
                    label: next,
                    color: "#7fbcff",
                    glyph: next,
                    shape: "circle",
                  },
                ],
              });
          }}
        >
          {t("Add symbol")}
        </button>
      </div>
      <p className="text-soft">
        {t(
          "Preview input is temporary. Use the public-sample button to copy it into the draft; test cases are edited separately below.",
        )}
      </p>
      <BoardVisualizer
        config={board}
        game={value.game}
        sampleInput={sampleInput || BOARD_EXAMPLE_INPUT}
        sampleOutput={sampleOutput || BOARD_EXAMPLE_OUTPUT}
        onUseSample={onUseSample}
      />
    </section>
  );
}

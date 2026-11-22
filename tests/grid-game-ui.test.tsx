import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { I18nProvider } from "../components/i18n-provider";
import { BoardPlayer, BoardVisualizer } from "../components/board-visualizer";
import { BoardSettings } from "../components/board-settings";
import { GamePreview } from "../components/game-preview";
import {
  DEFAULT_BOARD_CONFIG,
  DEFAULT_GRID_GAME,
  BOARD_EXAMPLE_INPUT,
  BOARD_EXAMPLE_OUTPUT,
  simulateGridGame,
} from "../lib/board-visualization";
import { DEFAULT_HEURISTIC_CONFIG } from "../lib/heuristic-config";

test("board authoring, replays, comparisons and game preview render accessibly in both languages", () => {
  for (const locale of ["ja", "en"] as const) {
    const config = {
      ...DEFAULT_HEURISTIC_CONFIG,
      visualizer: "board" as const,
      board: structuredClone(DEFAULT_BOARD_CONFIG),
      game: { ...DEFAULT_GRID_GAME },
    };
    config.board.symbols[0].label = "<img src=x onerror=alert(1)>";
    const html = renderToStaticMarkup(
      <AppRouterContext.Provider
        value={{
          bfcacheId: "game",
          back() {},
          forward() {},
          push() {},
          replace() {},
          refresh() {},
          prefetch() {},
        }}
      >
        <I18nProvider initialLocale={locale}>
          <BoardPlayer
            config={config.board}
            replay={simulateGridGame(
              BOARD_EXAMPLE_INPUT,
              BOARD_EXAMPLE_OUTPUT,
              config.board,
              config.game,
            )}
          />
          <BoardVisualizer
            config={config.board}
            sampleInput={BOARD_EXAMPLE_INPUT}
            sampleOutput={BOARD_EXAMPLE_OUTPUT}
          />
          <BoardSettings value={config} onChange={() => {}} />
          <GamePreview
            problemId="p1"
            config={config}
            sampleInput={BOARD_EXAMPLE_INPUT}
            sourceCode=""
            language="python"
          />
        </I18nProvider>
      </AppRouterContext.Provider>,
    );
    assert.ok(html.includes('role="img"'));
    assert.ok(html.includes('type="range"'));
    assert.ok(html.includes('type="button"'));
    assert.ok(html.includes("&lt;img"));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!html.includes("<script"));
    assert.ok(html.includes(locale === "ja" ? "盤面" : "Board"));
  }
});

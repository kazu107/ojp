import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  AppRouterContext,
} = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { I18nProvider } = require("../components/i18n-provider.tsx");
const { BoardVisualizer } = require("../components/board-visualizer.tsx");
const { DEFAULT_BOARD_CONFIG } = require("../lib/board-visualization.ts");
test("new ZIP samples reset the preview without discarding temporary input on palette edits", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const before = globalThis.document;
  globalThis.document = { documentElement: { lang: "ja" } };
  let tree;
  const render = (sampleInput, config = DEFAULT_BOARD_CONFIG) =>
    React.createElement(
      AppRouterContext.Provider,
      {
        value: {
          bfcacheId: "game-state",
          back() {},
          forward() {},
          push() {},
          replace() {},
          refresh() {},
          prefetch() {},
        },
      },
      React.createElement(
        I18nProvider,
        { initialLocale: "ja" },
        React.createElement(BoardVisualizer, {
          config,
          sampleInput,
          sampleOutput: "RIGHT\n",
        }),
      ),
    );
  try {
    await act(async () => {
      tree = create(render("1 2\nSG\n"));
    });
    await act(async () => {
      tree.root
        .findAllByType("textarea")[0]
        .props.onChange({ target: { value: "1 3\nS.G\n" } });
    });
    await act(async () => {
      tree.update(
        render("1 2\nSG\n", { ...DEFAULT_BOARD_CONFIG, coordinates: false }),
      );
    });
    assert.equal(
      tree.root.findAllByType("textarea")[0].props.value,
      "1 3\nS.G\n",
    );
    await act(async () => {
      tree.update(render("2 2\nSG\n##\n"));
    });
    assert.equal(
      tree.root.findAllByType("textarea")[0].props.value,
      "2 2\nSG\n##\n",
    );
    assert.equal(tree.root.findAllByType("textarea")[1].props.value, "RIGHT\n");
  } finally {
    if (tree) await act(async () => tree.unmount());
    globalThis.document = before;
  }
});

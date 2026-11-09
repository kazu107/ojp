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
const { HeuristicSettings } = require("../components/heuristic-settings.tsx");
const { DEFAULT_HEURISTIC_CONFIG } = require("../lib/heuristic-config.ts");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test("seed editor follows imported package metadata without replacing invalid typing or valid formatting", async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: "" } };
  const router = {
    bfcacheId: "heuristic-ui",
    back() {},
    forward() {},
    push() {},
    replace() {},
    refresh() {},
    prefetch() {},
  };
  let changed, tree;
  const render = (value) =>
    React.createElement(
      AppRouterContext.Provider,
      { value: router },
      React.createElement(
        I18nProvider,
        { initialLocale: "ja" },
        React.createElement(HeuristicSettings, {
          value,
          groups: ["provisional", "system"],
          onChange: (value) => {
            changed = value;
          },
        }),
      ),
    );
  try {
    await act(async () => {
      tree = create(render(undefined));
    });
    assert.equal(tree.root.findByType("textarea").props.value, "{}");
    await act(async () => {
      tree.update(
        render({
          ...DEFAULT_HEURISTIC_CONFIG,
          seeds: { "system/case01": "99" },
        }),
      );
    });
    assert.equal(
      JSON.parse(tree.root.findByType("textarea").props.value)["system/case01"],
      "99",
    );
    await act(async () => {
      tree.root
        .findByType("textarea")
        .props.onChange({ target: { value: "{" } });
    });
    assert.equal(tree.root.findByType("textarea").props.value, "{");
    assert.equal(changed, undefined);
    assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 1);
    await act(async () => {
      tree.update(
        render({
          ...DEFAULT_HEURISTIC_CONFIG,
          seeds: { "system/case01": "100" },
        }),
      );
    });
    assert.equal(
      JSON.parse(tree.root.findByType("textarea").props.value)["system/case01"],
      "100",
    );
    assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 0);
    const typed = '{"provisional/case01":"7"}';
    await act(async () => {
      tree.root
        .findByType("textarea")
        .props.onChange({ target: { value: typed } });
      tree.update(render(changed));
    });
    assert.equal(tree.root.findByType("textarea").props.value, typed);
    assert.deepEqual(changed.seeds, { "provisional/case01": "7" });
    await act(async () => {
      tree.update(render({ ...changed, direction: "minimize" }));
    });
    assert.equal(tree.root.findByType("textarea").props.value, typed);
  } finally {
    if (tree) await act(async () => tree.unmount());
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});

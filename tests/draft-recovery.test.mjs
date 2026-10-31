import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import React, { useState } from "react";
import { act, create } from "react-test-renderer";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DraftScope, useDraftRecovery } = require("../components/draft-recovery.tsx");
const { readLocalDraft, writeLocalDraft } = require("../lib/local-drafts.ts");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = new EventTarget();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(name, base = "v1") {
  let current;
  function Harness() {
    const [value, setValue] = useState("initial");
    const recovery = useDraftRecovery({ name, base, value, restore(saved) {
      if (typeof saved !== "string") throw new Error("invalid");
      setValue(saved);
    } });
    current = { value, setValue, recovery };
    return null;
  }
  const render = owner => React.createElement(DraftScope, { owner }, React.createElement(Harness));
  return { render, get current() { return current; } };
}

test("hook auto-saves, waits for explicit restore, and clears after a successful server action", async () => {
  const first = fixture("hook-reload"); let tree;
  await act(async () => { tree = create(first.render("alice")); });
  await act(async () => { await delay(30); });
  await act(async () => { first.current.setValue("unsent code"); });
  await act(async () => { await delay(900); });
  assert.equal((await readLocalDraft("alice:hook-reload", "alice")).data, "unsent code");
  await act(async () => { tree.unmount(); });
  const second = fixture("hook-reload", "v2");
  await act(async () => { tree = create(second.render("alice")); });
  await act(async () => { await delay(30); });
  assert.equal(second.current.value, "initial"); assert.ok(second.current.recovery.stale);
  await act(async () => { second.current.recovery.restore(); });
  assert.equal(second.current.value, "unsent code");
  await act(async () => { await second.current.recovery.clear(); tree.unmount(); });
  await delay(900);
  assert.equal(await readLocalDraft("alice:hook-reload", "alice"), null);
});

test("account switching remounts forms and does not expose another account's draft", async () => {
  const f = fixture("hook-owners"); let tree;
  await act(async () => { tree = create(f.render("alice")); });
  await act(async () => { await delay(30); f.current.setValue("alice code"); });
  await act(async () => { await delay(900); });
  await act(async () => { tree.update(f.render("bob")); });
  await act(async () => { await delay(30); });
  assert.equal(f.current.value, "initial"); assert.equal(f.current.recovery.pending, null);
  assert.equal((await readLocalDraft("alice:hook-owners", "alice")).data, "alice code");
  await act(async () => { tree.unmount(); });
});

test("conflicting tabs stop autosave and offer the new draft for explicit recovery", async () => {
  const f = fixture("hook-conflict"); let tree;
  await act(async () => { tree = create(f.render("alice")); });
  await act(async () => { await delay(30); f.current.setValue("first"); });
  await act(async () => { await delay(900); });
  const previous = await readLocalDraft("alice:hook-conflict", "alice");
  await writeLocalDraft({ ...previous, writer: "other-tab", updatedAt: previous.updatedAt + 1, data: "other code" }, previous.updatedAt);
  await act(async () => { f.current.setValue("my unsaved edit"); });
  await act(async () => { await delay(900); });
  assert.ok(f.current.recovery.pending); assert.equal(f.current.value, "my unsaved edit");
  await act(async () => { f.current.recovery.restore(); });
  assert.equal(f.current.value, "other code");
  await act(async () => { await f.current.recovery.clear(); tree.unmount(); });
});

test("leaving a form before the debounce attempts to preserve the last edit", async () => {
  const f = fixture("hook-leave"); let tree;
  await act(async () => { tree = create(f.render("alice")); });
  await act(async () => { await delay(30); f.current.setValue("last keystroke"); });
  await act(async () => { tree.unmount(); });
  await delay(30);
  assert.equal((await readLocalDraft("alice:hook-leave", "alice")).data, "last keystroke");
});

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  learningRunnerDocument,
  validLearningRunMessage,
} from "../lib/learning-runner";

test("sandbox permits only the public runtime path and generates no same-origin privilege", () => {
  const html = learningRunnerDocument(
    "https://example.com",
    "nonce-1",
    "token-1",
  );
  assert.ok(
    html.includes("connect-src https://example.com/learning-runtime/pyodide/;"),
  );
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("event.source !== parent"));
  assert.ok(!html.includes("allow-same-origin"));
  assert.ok(!html.includes("cdn.jsdelivr.net"));
});
test("sandbox configuration rejects script injection and non-HTTP origins", () => {
  assert.throws(
    () => learningRunnerDocument("https://example.com", '"></script>', "token"),
    /Invalid/,
  );
  assert.throws(
    () => learningRunnerDocument("file:///secret", "nonce", "token"),
    /Invalid/,
  );
});
test("message validation rejects unsupported messages and oversized output", () => {
  assert.equal(
    validLearningRunMessage({ type: "output", stream: "stdout", text: "OK" }),
    true,
  );
  assert.equal(
    validLearningRunMessage({ type: "navigate", url: "https://example.com" }),
    false,
  );
  assert.equal(
    validLearningRunMessage({ type: "output", stream: "html", text: "OK" }),
    false,
  );
  assert.equal(
    validLearningRunMessage({
      type: "output",
      stream: "stderr",
      text: "x".repeat(65537),
    }),
    false,
  );
  assert.equal(validLearningRunMessage({ type: "done", error: {} }), false);
});

test("student messages cannot postpone the execution deadline", () => {
  const html = learningRunnerDocument("https://example.com", "nonce", "token");
  const script = html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)![1];
  const timers: { callback: () => void; duration: number }[] = [];
  const messages: { type: string; error?: string }[] = [];
  const parent = {
    postMessage: (value: { type: string; error?: string }) =>
      messages.push(value),
  };
  let listener: (event: unknown) => void = () => {};
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: (event: { data: Record<string, unknown> }) => void = () => {};
    terminated = false;
    constructor() {
      workers.push(this);
    }
    postMessage() {}
    terminate() {
      this.terminated = true;
    }
  }
  vm.runInNewContext(script, {
    parent,
    Blob,
    TextEncoder,
    Worker: FakeWorker,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    addEventListener: (_type: string, callback: typeof listener) => {
      listener = callback;
    },
    setTimeout: (callback: () => void, duration: number) => {
      timers.push({ callback, duration });
      return timers.length;
    },
    clearTimeout() {},
  });
  listener({
    source: parent,
    data: {
      token: "token",
      type: "run",
      language: "javascript",
      source: "",
      stdin: "",
    },
  });
  const worker = workers[0];
  worker!.onmessage({ data: { type: "running" } });
  for (let i = 0; i < 100; i++)
    worker!.onmessage({ data: { type: "running" } });
  assert.equal(timers.filter((timer) => timer.duration === 10000).length, 1);
  assert.equal(
    messages.filter((message) => message.type === "running").length,
    1,
  );
  timers.find((timer) => timer.duration === 10000)!.callback();
  assert.equal(worker!.terminated, true);
  assert.equal(messages.at(-1)?.error, "Execution timed out (10 seconds).");
});

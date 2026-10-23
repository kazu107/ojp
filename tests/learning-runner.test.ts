import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { Worker } from "node:worker_threads";
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

async function runBrowserBrainfuck(source: string, stdin = "", shortenDeadline = false) {
  const html = learningRunnerDocument("https://example.com", "nonce", "token");
  const script = html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)![1];
  const messages: Array<{ type: string; stream?: string; text?: string; error?: string | null }> = [];
  let receive: (event: unknown) => void = () => {};
  let workerBlob: Blob;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const workers: SandboxWorker[] = [];
  let complete!: () => void;
  const done = new Promise<void>((resolve) => { complete = resolve; });
  const parent = { postMessage(value: (typeof messages)[number]) {
    messages.push(value);
    if (value.type === "done") complete();
  } };
  class SandboxWorker {
    onmessage: (event: { data: unknown }) => void = () => {};
    onerror: (event: { message: string }) => void = () => {};
    native?: Worker;
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(data: unknown) {
      void workerBlob.text().then((text) => {
        if (this.terminated) return;
        this.native = new Worker(`const { parentPort } = require("node:worker_threads");
const self = { postMessage: (value) => parentPort.postMessage(value) };
${text}
parentPort.on("message", (data) => self.onmessage({ data }));`, { eval: true });
        this.native.on("message", (value) => this.onmessage({ data: value }));
        this.native.on("error", (error) => this.onerror({ message: error.message }));
        this.native.postMessage(data);
      });
    }
    terminate() { this.terminated = true; void this.native?.terminate(); }
  }
  try {
    vm.runInNewContext(script, {
      parent, Blob, TextEncoder, Worker: SandboxWorker,
      URL: { createObjectURL(blob: Blob) { workerBlob = blob; return "blob:brainfuck-test"; }, revokeObjectURL() {} },
      addEventListener(_type: string, callback: typeof receive) { receive = callback; },
      setTimeout(callback: () => void, duration: number) {
        const timer = setTimeout(callback, shortenDeadline && duration === 10000 ? 100 : duration);
        timers.add(timer);
        return timer;
      },
      clearTimeout,
    });
    receive({ source: parent, data: { token: "token", type: "run", language: "brainfuck", source, stdin } });
    await done;
    return { messages, stopped: workers.every((worker) => worker.terminated) };
  } finally {
    for (const timer of timers) clearTimeout(timer);
    for (const worker of workers) worker.terminate();
  }
}

test("generated browser worker runs Brainfuck and streams UTF-8 across decoder chunks", { timeout: 10000 }, async () => {
  const stdin = "あ".repeat(600) + "\n";
  const result = await runBrowserBrainfuck(",[.,]", stdin);
  assert.equal(result.messages.filter((message) => message.stream === "stdout").map((message) => message.text).join(""), stdin);
  assert.equal(result.messages.at(-1)?.error, null);
  assert.equal(result.stopped, true);
});

test("generated browser worker reports Brainfuck syntax and tape-boundary errors", { timeout: 10000 }, async () => {
  for (const [source, error] of [["][", /Unmatched/], ["<", /outside/]] as const) {
    const result = await runBrowserBrainfuck(source);
    assert.match(result.messages.at(-1)?.error ?? "", error);
    assert.equal(result.stopped, true);
  }
});

test("generated browser worker bounds Brainfuck output to 64 KiB", { timeout: 10000 }, async () => {
  const result = await runBrowserBrainfuck("+".repeat(65) + "[.]");
  const output = result.messages.filter((message) => message.stream === "stdout").map((message) => message.text).join("");
  assert.equal(new TextEncoder().encode(output).length, 65536);
  assert.match(result.messages.at(-1)?.error ?? "", /Output limit exceeded/);
  assert.equal(result.stopped, true);
});

test("embedder watchdog terminates an infinite Brainfuck worker", { timeout: 10000 }, async () => {
  const result = await runBrowserBrainfuck("+[]", "", true);
  assert.equal(result.messages.at(-1)?.error, "Execution timed out (10 seconds).");
  assert.equal(result.stopped, true);
});

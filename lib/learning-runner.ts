import {
  LEARNING_EXECUTION_MS,
  LEARNING_MAX_OUTPUT,
  LEARNING_PREPARATION_MS,
} from "./learning";

export interface LearningRunRequest {
  language: "python" | "javascript";
  source: string;
  stdin: string;
}
export type LearningRunMessage =
  | { type: "ready" | "running" }
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  | { type: "done"; error: string | null };

export function validLearningRunMessage(
  raw: unknown,
): raw is LearningRunMessage {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Record<string, unknown>;
  if (value.type === "ready" || value.type === "running") return true;
  if (value.type === "output")
    return (
      ["stdout", "stderr"].includes(String(value.stream)) &&
      typeof value.text === "string" &&
      value.text.length <= LEARNING_MAX_OUTPUT
    );
  return (
    value.type === "done" &&
    (value.error === null ||
      (typeof value.error === "string" &&
        value.error.length <= LEARNING_MAX_OUTPUT))
  );
}

// This source runs only in an opaque-origin worker, never in the application window.
const workerSource = `
const send = self.postMessage.bind(self);
let outputLength = 0;
const maxOutput = ${LEARNING_MAX_OUTPUT};
const encoder = new TextEncoder();
function output(stream, text) {
  text = String(text);
  outputLength += encoder.encode(text).length;
  if (outputLength > maxOutput) throw new Error("Output limit exceeded (64 KiB).");
  send({ type: "output", stream, text });
}
self.onmessage = async ({ data }) => {
  try {
    if (data.language === "python") {
      const { loadPyodide } = await import(data.runtime + "pyodide.mjs");
      const py = await loadPyodide({ indexURL: data.runtime, stdout: () => {}, stderr: () => {} });
      const input = new TextEncoder().encode(data.stdin);
      let position = 0;
      py.setStdin({ read: (buffer) => {
        const count = Math.min(buffer.length, input.length - position);
        buffer.set(input.subarray(position, position + count)); position += count; return count;
      }, isatty: false });
      const stdoutDecoder = new TextDecoder(), stderrDecoder = new TextDecoder();
      py.setStdout({ write: (buffer) => { output("stdout", stdoutDecoder.decode(buffer, { stream: true })); return buffer.length; } });
      py.setStderr({ write: (buffer) => { output("stderr", stderrDecoder.decode(buffer, { stream: true })); return buffer.length; } });
      send({ type: "running" });
      const dict = py.globals.get("dict");
      const globals = dict();
      globals.set("__name__", "__main__");
      globals.set("__file__", "<lesson>");
      dict.destroy();
      try { await py.runPythonAsync(data.source, { globals }); }
      finally { globals.destroy(); output("stdout", stdoutDecoder.decode()); output("stderr", stderrDecoder.decode()); }
    } else if (data.language === "javascript") {
      send({ type: "running" });
      const lines = data.stdin.replace(/\\r\\n/g, "\\n").split("\\n");
      let position = 0;
      const console = { log: (...values) => output("stdout", values.join(" ") + "\\n"), error: (...values) => output("stderr", values.join(" ") + "\\n") };
      const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
      await new AsyncFunction("console", "input", "print", data.source)(console, () => lines[position++] ?? null, console.log);
    } else throw new Error("Unsupported runtime language.");
    send({ type: "done", error: null });
  } catch (error) { send({ type: "done", error: String(error?.message ?? error).slice(0, maxOutput) }); }
};
`;

function safeScriptJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function learningRunnerDocument(
  applicationOrigin: string,
  nonce: string,
  token: string,
): string {
  const origin = new URL(applicationOrigin).origin;
  if (
    !/^https?:\/\//.test(origin) ||
    !/^[a-zA-Z0-9_-]+$/.test(nonce) ||
    !/^[a-zA-Z0-9_-]+$/.test(token)
  )
    throw new Error("Invalid sandbox configuration.");
  const runtime = `${origin}/learning-runtime/pyodide/`;
  // blob workers inherit this CSP. Only the public, self-hosted runtime directory is reachable.
  const policy = `default-src 'none'; script-src 'nonce-${nonce}' blob: ${runtime} 'unsafe-eval' 'wasm-unsafe-eval'; connect-src ${runtime}; worker-src blob:; child-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  const script = `
const token = ${safeScriptJson(token)};
const runtime = ${safeScriptJson(runtime)};
const workerText = ${safeScriptJson(workerSource)};
let worker, workerURL, prepareTimer, runTimer, outputCount = 0, started = false;
const send = (message) => parent.postMessage({ token, ...message }, "*");
function finish(error) {
  clearTimeout(prepareTimer); clearTimeout(runTimer);
  if (worker) { worker.terminate(); worker = null; }
  if (workerURL) { URL.revokeObjectURL(workerURL); workerURL = null; }
  send({ type: "done", error });
}
addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.token !== token || event.data.type !== "run" || worker) return;
  const request = event.data;
  if (!["python", "javascript"].includes(request.language) || typeof request.source !== "string" || request.source.length > 262144 || typeof request.stdin !== "string" || request.stdin.length > 65536) return finish("Invalid run request.");
  workerURL = URL.createObjectURL(new Blob([workerText], { type: "text/javascript" }));
  try { worker = new Worker(workerURL); }
  catch (error) { return finish(String(error)); }
  prepareTimer = setTimeout(() => finish("Runtime preparation timed out."), ${LEARNING_PREPARATION_MS});
  worker.onerror = (event) => finish(event.message || "Browser runtime failed to load or execute.");
  worker.onmessage = ({ data }) => {
    if (data?.type === "running") {
      if (started) return;
      started = true;
      clearTimeout(prepareTimer);
      runTimer = setTimeout(() => finish("Execution timed out (10 seconds)."), ${LEARNING_EXECUTION_MS});
      send({ type: "running" });
    } else if (data?.type === "output" && ["stdout", "stderr"].includes(data.stream) && typeof data.text === "string") {
      if (data.text.length > ${LEARNING_MAX_OUTPUT}) return finish("Output limit exceeded (64 KiB).");
      outputCount += new TextEncoder().encode(data.text).length;
      if (outputCount > ${LEARNING_MAX_OUTPUT}) return finish("Output limit exceeded (64 KiB).");
      send({ type: "output", stream: data.stream, text: data.text });
    } else if (data?.type === "done") finish(typeof data.error === "string" ? data.error.slice(0, ${LEARNING_MAX_OUTPUT}) : null);
  };
  worker.postMessage({ language: request.language, source: request.source, stdin: request.stdin, runtime });
});
send({ type: "ready" });
`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body><script nonce="${nonce}">${script}</script></body></html>`;
}

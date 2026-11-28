import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";

const BYTES = 65536;
const API = "/api/agent/v1/delivery";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DECODER = () => new TextDecoder("utf-8", { fatal: true });

function assertUuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(label + " must be a UUID");
  return value;
}

function sourceArgs(args) {
  if (typeof args.language !== "string" || !/^[a-z]+$/.test(args.language) || args.language.length > 20)
    throw new Error("A valid language is required");
  if (typeof args.sourceCode !== "string" || !args.sourceCode.trim() || args.sourceCode.includes("\0") ||
      Buffer.byteLength(args.sourceCode, "utf8") > BYTES) throw new Error("Source must be nonempty text up to 65536 bytes");
  return { language: args.language, sourceCode: args.sourceCode };
}

async function readBounded(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OJP response is empty");
  const decoder = DECODER();
  let size = 0, text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) {
        await reader.cancel().catch(() => undefined);
        throw new Error("OJP response is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid OJP response");
    return body;
  } finally { reader.releaseLock(); }
}

class AgentApiError extends Error {
  constructor(status, message, retryAfter) {
    super(message);
    this.status = status;
    if (retryAfter > 0) this.retryAfterSeconds = retryAfter;
  }
}

function clientFromEnvironment() {
  const origin = new URL(process.env.OJP_AGENT_URL || "https://ojp.kazu107.xyz");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if (!(origin.protocol === "https:" || (loopback && origin.protocol === "http:")) ||
      origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
    throw new Error("OJP_AGENT_URL must be an HTTPS origin (HTTP is allowed only for loopback)");
  const token = process.env.OJP_AGENT_TOKEN;
  if (!/^ojp_agent_v1_[A-Za-z0-9_-]{43}$/.test(token ?? ""))
    throw new Error("Set OJP_AGENT_TOKEN to a valid OJP agent token");
  async function request(path, body, requestKey) {
    const headers = { Authorization: "Bearer " + token };
    if (body) headers["Content-Type"] = "application/json";
    if (requestKey) headers["Idempotency-Key"] = requestKey;
    const response = await fetch(new URL(API + path, origin), {
      method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
      redirect: "error", signal: AbortSignal.timeout(15000),
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new AgentApiError(response.status, "OJP did not return a JSON API response", 0);
    const data = await readBounded(response);
    const retry = Number(response.headers.get("retry-after")) || 0;
    if (!response.ok) {
      const bodyMessage = typeof data.error === "string" ? data.error.slice(0, 200) : "OJP agent request failed";
      throw new AgentApiError(response.status, bodyMessage, retry);
    }
    if (retry > 0) data.retryAfterSeconds = retry;
    for (const key of ["reviewPath", "resultPath", "replayPath"]) {
      if (typeof data[key] !== "string" || !data[key].startsWith("/")) continue;
      const url = new URL(data[key], origin);
      if (url.origin === origin.origin) data[key.replace("Path", "Url")] = url.href;
    }
    return data;
  }

  return {
    get_game: () => request("/game"),
    run_trial: async args => {
      const key = args.requestKey === undefined ? randomUUID() : assertUuid(args.requestKey, "Request key");
      return { ...await request("/trials", sourceArgs(args), key), requestKey: key };
    },
    get_trial: args => request("/trials/" + assertUuid(args.trialId, "Trial ID")),
    prepare_registration: args => {
      const trialId = assertUuid(args.trialId, "Trial ID");
      if (typeof args.name !== "string" || !args.name.trim() || args.name.length > 40) throw new Error("A bot name up to 40 characters is required");
      return request("/drafts", { ...sourceArgs(args), name: args.name, trialId });
    },
  };
}

const sourceSchema = {
  language: { type: "string", description: "OJP language ID from get_game" },
  sourceCode: { type: "string", maxLength: BYTES, description: "The code to test; do not include credentials" },
};
const trialId = { type: "string", format: "uuid", description: "ID returned by run_trial" };
const tools = [
  { name: "get_game", description: "Get Delivery Duel rules, protocol and starter code. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "run_trial", description: "Queue a private unranked trial. If retrying the same request, reuse its requestKey.",
    inputSchema: { type: "object", properties: { ...sourceSchema, requestKey: { type: "string", format: "uuid" } },
      required: ["language", "sourceCode"], additionalProperties: false } },
  { name: "get_trial", description: "Get your private trial status, results and replay. Wait before polling pending trials again.",
    inputSchema: { type: "object", properties: { trialId }, required: ["trialId"], additionalProperties: false } },
  { name: "prepare_registration", description: "Create a reviewable draft with exactly the tested code. Does not register the bot or change the ranking.",
    inputSchema: { type: "object", properties: { ...sourceSchema, trialId, name: { type: "string", maxLength: 40 } },
      required: ["trialId", "name", "language", "sourceCode"], additionalProperties: false } },
];

function errorInfo(error) {
  return { error: error instanceof Error ? error.message : "OJP request failed",
    ...(error instanceof AgentApiError ? { status: error.status, retryAfterSeconds: error.retryAfterSeconds } : {}) };
}

async function startMcp(client) {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
  const server = new Server({ name: "ojp-delivery", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const tool = tools.find(tool => tool.name === request.params.name);
      if (!tool) throw new Error("Unknown OJP tool");
      const args = request.params.arguments ?? {};
      if (Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties, key)))
        throw new Error("Unexpected argument");
      const result = await client[tool.name](args);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: JSON.stringify(errorInfo(error)) }] };
    }
  });
  await server.connect(new StdioServerTransport());
}

async function readSource(path) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > BYTES) throw new Error("Source file must be a regular file up to 65536 bytes");
    const buffer = Buffer.alloc(BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const chunk = await file.read(buffer, size, buffer.length - size, null);
      if (!chunk.bytesRead) break;
      size += chunk.bytesRead;
    }
    if (size > BYTES) throw new Error("Source file is too large");
    return DECODER().decode(buffer.subarray(0, size));
  } finally { await file.close(); }
}

const usage = `Usage: node scripts/ojp-agent.mjs <command>
  game
  trial <language> <file> [request-key]
  result <trial-id>
  draft <trial-id> <bot-name> <language> <file>
  mcp

Set OJP_AGENT_TOKEN in the environment. OJP_AGENT_URL defaults to https://ojp.kazu107.xyz.`;

async function main([command, ...args]) {
  if (!command || command === "--help" || command === "help") { console.log(usage); return; }
  const client = clientFromEnvironment();
  if (command === "mcp" && !args.length) return startMcp(client);
  let result;
  if (command === "game" && !args.length) result = await client.get_game();
  else if (command === "trial" && (args.length === 2 || args.length === 3))
    result = await client.run_trial({ language: args[0], sourceCode: await readSource(args[1]), requestKey: args[2] });
  else if (command === "result" && args.length === 1) result = await client.get_trial({ trialId: args[0] });
  else if (command === "draft" && args.length === 4)
    result = await client.prepare_registration({ trialId: args[0], name: args[1], language: args[2], sourceCode: await readSource(args[3]) });
  else throw new Error(usage);
  console.log(JSON.stringify(result, null, 2));
}

main(process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify(errorInfo(error)));
  process.exitCode = 1;
});

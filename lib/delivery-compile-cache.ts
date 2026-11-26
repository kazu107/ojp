import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Language } from "./types";

const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 48;
type Artifacts = { files: { name: string; data: Buffer }[]; bytes: number };
const ready = new Map<string, Artifacts>();
const preparing = new Map<string, Promise<Artifacts | null>>();
let cachedBytes = 0;

async function readArtifacts(cwd: string, language: Language): Promise<Artifacts | null> {
  let names: string[];
  switch (language) {
    case "c": case "cpp": case "go": case "rust": names = ["main"]; break;
    case "csharp": names = ["main.exe"]; break;
    case "kotlin": names = ["main.jar"]; break;
    case "java":
      names = (await readdir(cwd)).filter(name => name.endsWith(".class"));
      if (!names.includes("Main.class") || names.length > 128 || names.some(name => !/^[A-Za-z0-9_$-]+\.class$/.test(name))) return null;
      break;
    case "javascript": case "ruby": case "brainfuck": names = []; break;
    default: return null;
  }
  const files: Artifacts["files"] = [];
  let bytes = 0;
  for (const name of names) {
    const file = await open(path.join(cwd, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || bytes + stat.size > MAX_ARTIFACT_BYTES) return null;
      const data = Buffer.alloc(stat.size);
      if ((await file.read(data)).bytesRead !== stat.size) return null;
      files.push({ name, data });
      bytes += stat.size;
    } finally { await file.close(); }
  }
  return { files, bytes };
}

function remember(key: string, item: Artifacts) {
  ready.set(key, item);
  cachedBytes += item.bytes;
  while (ready.size > MAX_ENTRIES || cachedBytes > MAX_CACHE_BYTES) {
    const oldest = ready.entries().next().value!;
    ready.delete(oldest[0]);
    cachedBytes -= oldest[1].bytes;
  }
}

export async function compileDeliveryProgram<T extends { ok: boolean }>(
  cwd: string, language: Language, sourceCode: string, versionId: string | null, sandbox: string, compile: () => Promise<T>,
): Promise<{ result: T | { ok: true }; cacheHit: boolean; compileMs: number }> {
  const compileHere = async () => {
    const start = performance.now();
    const result = await compile();
    return { result, cacheHit: false, compileMs: Math.round(performance.now() - start) };
  };
  if (process.platform !== "linux" || sandbox !== "bubblewrap" || !versionId || process.env.DELIVERY_COMPILE_CACHE === "0" ||
      language === "python" || language === "pypy") return compileHere();
  // This cache lives only in one worker process, whose toolchain is fixed for its lifetime.
  const key = createHash("sha256").update(JSON.stringify([versionId, language, sourceCode])).digest("hex");
  let item = ready.get(key);
  if (item) {
    ready.delete(key);
    ready.set(key, item);
  } else if (preparing.has(key)) {
    item = (await preparing.get(key)) ?? undefined;
    if (!item) return compileHere();
  }
  if (item) {
    for (const { name, data } of item.files)
      await writeFile(path.join(cwd, name), data, { flag: "wx", mode: 0o700 });
    return { result: { ok: true }, cacheHit: true, compileMs: 0 };
  }
  let finish: (item: Artifacts | null) => void = () => {};
  preparing.set(key, new Promise(resolve => { finish = resolve; }));
  let built: Artifacts | null = null;
  try {
    const prepared = await compileHere();
    if (prepared.result.ok) {
      built = await readArtifacts(cwd, language).catch(() => null);
      if (built) remember(key, built);
    }
    return prepared;
  } finally {
    preparing.delete(key);
    finish(built);
  }
}

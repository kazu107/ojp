import { mkdir, copyFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const source = path.dirname(require.resolve("pyodide/package.json"));
const destination = path.resolve("public/learning-runtime/pyodide");
const version = JSON.parse(
  await readFile(path.join(source, "package.json"), "utf8"),
).version;
if (version !== "0.27.7")
  throw new Error(
    "Unexpected Pyodide version; review the runtime before upgrading.",
  );
await mkdir(destination, { recursive: true });
for (const file of [
  "pyodide.mjs",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
]) {
  await copyFile(path.join(source, file), path.join(destination, file));
}
console.log(
  `Prepared browser Python ${version}; no external runtime CDN required.`,
);

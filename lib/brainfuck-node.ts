import { runBrainfuck } from "./brainfuck.js";

// Source is interpreted as data, not JavaScript. Keep all file access in this trusted adapter.
export function brainfuckNodeRunner(): string {
  return `"use strict";
const fs = require("node:fs");
const runBrainfuck = ${runBrainfuck.toString()};
const input = Buffer.allocUnsafe(65536);
const output = Buffer.allocUnsafe(8192);
let readPosition = 0, readLength = 0, outputLength = 0;
function flush() {
  let written = 0;
  while (written < outputLength) written += fs.writeSync(1, output, written, outputLength - written);
  outputLength = 0;
}
function readByte() {
  if (process.argv.includes("--interactive")) flush();
  if (readPosition === readLength) {
    readLength = fs.readSync(0, input, 0, input.length, null);
    readPosition = 0;
    if (!readLength) return 0;
  }
  return input[readPosition++];
}
function writeByte(value) {
  output[outputLength++] = value;
  if (outputLength === output.length || (value === 10 && process.argv.includes("--interactive"))) flush();
}
try {
  runBrainfuck(fs.readFileSync(process.argv[2], "utf8"), readByte, writeByte, process.argv[3] === "--check");
  flush();
} catch (error) {
  flush();
  fs.writeSync(2, String(error && error.message || error) + "\\n");
  process.exitCode = 1;
}
`;
}

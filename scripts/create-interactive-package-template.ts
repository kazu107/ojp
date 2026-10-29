import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { INTERACTOR_SOURCE_TEMPLATES } from "../lib/interactor-source-templates";
import { checkerSourceFileName, validateProblemPackage } from "../lib/problem-package";
import { CHECKER_LANGUAGES, type CheckerLanguage } from "../lib/languages";

async function main() {
  const args = process.argv.slice(2);
  let output = "interactive-guess.zip";
  let language: CheckerLanguage = "python";
  let force = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") { console.log("--output PATH --language python|cpp|java|javascript [--force]"); return; }
    if (arg === "--force") { force = true; continue; }
    if (arg === "--output" && args[index + 1]) { output = args[++index]; continue; }
    if (arg === "--language" && CHECKER_LANGUAGES.includes(args[index + 1] as CheckerLanguage)) { language = args[++index] as CheckerLanguage; continue; }
    throw new Error(`invalid option: ${arg}`);
  }
  const target = path.resolve(output);
  if (existsSync(target) && !force) throw new Error("output already exists; use --force to overwrite");
  const zip = new AdmZip();
  zip.addFile("statement.md", Buffer.from(`# Guess the Secret

Find a hidden integer between 1 and 1000.

## Input
This is an interactive problem. First read the integer 1000.
Print "? x" and flush to ask about an integer x. Read SMALLER, LARGER, or EQUAL.
The response describes the hidden integer relative to x. At most 10 queries are allowed.

## Output
Print "! x", flush, and terminate when you know the secret.

## Constraints
- 1 <= x <= 1000
`));
  zip.addFile("config.json", Buffer.from(JSON.stringify({
    judgeType: "interactive", interactorLanguage: language, timeLimitMs: 2000, memoryLimitMb: 256,
    interactive: { idleTimeLimitMs: 5000, wallTimeLimitMs: 30000, interactorTimeLimitMs: 10000 },
    groups: ["group1"], samples: [{ name: "sample01", description: "< is interactor output; > is submission output." }],
  }, null, 2)));
  zip.addFile(checkerSourceFileName(language, "interactive"), Buffer.from(INTERACTOR_SOURCE_TEMPLATES[language]));
  zip.addFile("samples/sample01.interaction", Buffer.from("< 1000\n> ? 500\n< SMALLER\n> ? 37\n< EQUAL\n> ! 37\n"));
  [1, 37, 500, 999, 1000].forEach((secret, index) => zip.addFile(`tests/group1/case${String(index+1).padStart(2,"0")}.in`, Buffer.from(`${secret}\n`)));
  const buffer = zip.toBuffer();
  validateProblemPackage(path.basename(target), buffer);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer);
  console.log(`Created ${target} (${language}, 5 cases)`);
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

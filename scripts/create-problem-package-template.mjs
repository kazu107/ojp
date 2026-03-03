import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import AdmZip from "adm-zip";

const DEFAULT_OUTPUT = "problem-package-template.zip";
const DEFAULT_MODE = "partial";
const DEFAULT_GROUP_COUNT = 2;
const DEFAULT_TESTS_PER_GROUP = 2;

function printHelp() {
  console.log(`Create a problem ZIP template for OJP.

Usage:
  npm run template:problem-zip
  npm run template:problem-zip -- --mode partial --output ./my-problem.zip
  npm run template:problem-zip -- --mode binary --groups 3 --tests-per-group 4

Options:
  -o, --output <path>          Output zip path (default: ${DEFAULT_OUTPUT})
  -m, --mode <partial|binary>  Scoring mode template (default: ${DEFAULT_MODE})
      --groups <number>        Number of test groups (default: ${DEFAULT_GROUP_COUNT})
      --tests-per-group <n>    Number of tests per group (default: ${DEFAULT_TESTS_PER_GROUP})
  -f, --force                  Overwrite output file if it already exists
  -h, --help                   Show this help
`);
}

function parsePositiveInt(raw, name) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseMode(raw) {
  if (raw === "partial" || raw === "binary") {
    return raw;
  }
  throw new Error("mode must be either 'partial' or 'binary'");
}

function parseArgs(argv) {
  const options = {
    output: DEFAULT_OUTPUT,
    mode: DEFAULT_MODE,
    groups: DEFAULT_GROUP_COUNT,
    testsPerGroup: DEFAULT_TESTS_PER_GROUP,
    force: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "-f" || arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "-o" || arg === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value for --output");
      }
      options.output = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
      continue;
    }

    if (arg === "-m" || arg === "--mode") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value for --mode");
      }
      options.mode = parseMode(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      options.mode = parseMode(arg.slice("--mode=".length));
      continue;
    }

    if (arg === "--groups") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value for --groups");
      }
      options.groups = parsePositiveInt(value, "groups");
      index += 1;
      continue;
    }
    if (arg.startsWith("--groups=")) {
      options.groups = parsePositiveInt(arg.slice("--groups=".length), "groups");
      continue;
    }

    if (arg === "--tests-per-group") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value for --tests-per-group");
      }
      options.testsPerGroup = parsePositiveInt(value, "tests-per-group");
      index += 1;
      continue;
    }
    if (arg.startsWith("--tests-per-group=")) {
      options.testsPerGroup = parsePositiveInt(
        arg.slice("--tests-per-group=".length),
        "tests-per-group",
      );
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  options.mode = parseMode(options.mode);
  options.groups = parsePositiveInt(String(options.groups), "groups");
  options.testsPerGroup = parsePositiveInt(String(options.testsPerGroup), "tests-per-group");
  return options;
}

function normalizeOutputPath(rawOutput) {
  const trimmed = rawOutput.trim();
  const withExtension = trimmed.toLowerCase().endsWith(".zip") ? trimmed : `${trimmed}.zip`;
  return path.resolve(process.cwd(), withExtension);
}

function makeGroupName(index) {
  return `group${index + 1}`;
}

function makeCaseName(index) {
  return String(index + 1).padStart(2, "0");
}

function distributeScores(groupCount) {
  const base = Math.floor(100 / groupCount);
  const remainder = 100 - base * groupCount;
  return Array.from({ length: groupCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function buildConfig(options) {
  const scores = options.mode === "partial" ? distributeScores(options.groups) : null;
  const groups = Array.from({ length: options.groups }, (_, groupIndex) => {
    const tests = Array.from({ length: options.testsPerGroup }, (_, caseIndex) =>
      makeCaseName(caseIndex),
    );

    if (scores) {
      return {
        name: makeGroupName(groupIndex),
        score: scores[groupIndex],
        tests,
      };
    }

    return {
      name: makeGroupName(groupIndex),
      tests,
    };
  });

  return {
    timeLimitMs: 2000,
    memoryLimitMb: 512,
    scoringType: options.mode === "partial" ? "sum_of_groups" : "binary",
    compareMode: "exact",
    languages: ["cpp", "python", "java", "javascript"],
    groups,
  };
}

function buildStatementMarkdown() {
  return `# A - Echo

Read one integer **N** and print it.

## Input
N

## Output
Print N.

## Constraints
- 0 <= N <= 10^9
`;
}

function buildCaseValue(groupIndex, caseIndex) {
  return groupIndex * 100 + caseIndex + 1;
}

function addProblemPackageFiles(zip, options) {
  zip.addFile("statement.md", Buffer.from(buildStatementMarkdown(), "utf8"));

  const config = buildConfig(options);
  zip.addFile("config.json", Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"));

  zip.addFile("samples/sample1.in", Buffer.from("1\n", "utf8"));
  zip.addFile("samples/sample1.out", Buffer.from("1\n", "utf8"));
  zip.addFile("samples/sample2.in", Buffer.from("42\n", "utf8"));
  zip.addFile("samples/sample2.out", Buffer.from("42\n", "utf8"));

  for (let groupIndex = 0; groupIndex < options.groups; groupIndex += 1) {
    const groupName = makeGroupName(groupIndex);
    for (let caseIndex = 0; caseIndex < options.testsPerGroup; caseIndex += 1) {
      const caseName = makeCaseName(caseIndex);
      const value = buildCaseValue(groupIndex, caseIndex);
      zip.addFile(`tests/${groupName}/${caseName}.in`, Buffer.from(`${value}\n`, "utf8"));
      zip.addFile(`tests/${groupName}/${caseName}.out`, Buffer.from(`${value}\n`, "utf8"));
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const outputPath = normalizeOutputPath(options.output);
  if (existsSync(outputPath) && !options.force) {
    throw new Error(`output file already exists: ${outputPath} (use --force to overwrite)`);
  }

  const zip = new AdmZip();
  addProblemPackageFiles(zip, options);
  zip.writeZip(outputPath);

  console.log(`[template:problem-zip] created: ${outputPath}`);
  console.log(
    `[template:problem-zip] mode=${options.mode}, groups=${options.groups}, tests/group=${options.testsPerGroup}`,
  );
}

try {
  main();
} catch (error) {
  console.error(
    `[template:problem-zip] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

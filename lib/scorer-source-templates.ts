import type { CheckerLanguage } from "./types";
// Example contract: input N; output an integer x in [0,N]; raw score x.
export const SCORER_SOURCE_TEMPLATES: Record<CheckerLanguage, string> = {
  python: `import json, sys
from pathlib import Path
n = int(Path(sys.argv[1]).read_text().split()[0])
try:
    text = Path(sys.argv[3]).read_text().strip()
    x = int(text)
    valid = str(x) == text and 0 <= x <= n
except (ValueError, IndexError):
    valid, x = False, 0
print(json.dumps({"version": 1, "valid": valid, "score": str(x) if valid else None}))
`,
  cpp: `#include <fstream>
#include <iostream>
#include <string>
using namespace std;
int main(int argc, char** argv) {
    if (argc != 4) return 2;
    ifstream input(argv[1]), output(argv[3]);
    long long n, x; string extra;
    if (!(input >> n)) return 2;
    bool valid = bool(output >> x) && !(output >> extra) && 0 <= x && x <= n;
    cout << "{\\"version\\":1,\\"valid\\":" << (valid ? "true" : "false") << ",\\"score\\":";
    if (valid) cout << "\\"" << x << "\\""; else cout << "null";
    cout << "}\\n";
}
`,
  java: `import java.nio.file.*;
public class Main {
    public static void main(String[] args) throws Exception {
        long n = Long.parseLong(Files.readString(Path.of(args[0])).trim().split("\\\\s+")[0]);
        String text = Files.readString(Path.of(args[2])).trim();
        boolean valid = false; long x = 0;
        try { x = Long.parseLong(text); valid = 0 <= x && x <= n; } catch (NumberFormatException ignored) {}
        System.out.println("{\\"version\\":1,\\"valid\\":" + valid + ",\\"score\\":" + (valid ? "\\""+x+"\\"" : "null") + "}");
    }
}
`,
  javascript: `const fs = require('node:fs');
const n = BigInt(fs.readFileSync(process.argv[2], 'utf8').trim().split(/\\s+/)[0]);
const text = fs.readFileSync(process.argv[4], 'utf8').trim();
let valid = false, x = 0n;
if (/^(0|[1-9][0-9]*)$/.test(text)) { x = BigInt(text); valid = x <= n; }
console.log(JSON.stringify({version: 1, valid, score: valid ? String(x) : null}));
`,
};
export function isDefaultScorerTemplate(value: string) {
  return Object.values(SCORER_SOURCE_TEMPLATES).some(
    (source) => source.trim() === value.trim(),
  );
}

import type { CheckerLanguage } from "./types";

// Example protocol: guess a secret integer in [1, 1000] using at most 10 queries.
export const INTERACTOR_SOURCE_TEMPLATES: Record<CheckerLanguage, string> = {
  python: `import sys

def main():
    # argv[1] is private test data. Never print the secret.
    with open(sys.argv[1], encoding="utf-8-sig") as f:
        secret = int(f.read().strip())
    if not 1 <= secret <= 1000:
        return 2
    print(1000, flush=True)
    queries = 0
    for line in sys.stdin:
        parts = line.split()
        if len(parts) != 2 or parts[0] not in ("?", "!"):
            return 1
        try:
            value = int(parts[1])
        except ValueError:
            return 1
        if not 1 <= value <= 1000:
            return 1
        if parts[0] == "!":
            return 0 if value == secret else 1
        queries += 1
        if queries > 10:
            return 1
        print("SMALLER" if secret < value else "LARGER" if secret > value else "EQUAL", flush=True)
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
`,
  cpp: `#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
using namespace std;
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    ifstream data(argv[1]);
    int secret;
    if (!(data >> secret) || secret < 1 || secret > 1000) return 2;
    cout << 1000 << endl; // endl flushes the response.
    string line;
    int queries = 0;
    while (getline(cin, line)) {
        istringstream in(line);
        string op, extra;
        int value;
        if (!(in >> op >> value) || (in >> extra) || value < 1 || value > 1000) return 1;
        if (op == "!") return value == secret ? 0 : 1;
        if (op != "?" || ++queries > 10) return 1;
        cout << (secret < value ? "SMALLER" : secret > value ? "LARGER" : "EQUAL") << endl;
    }
    return 1;
}
`,
  java: `import java.io.*;
import java.nio.file.*;
public class Main {
    static int run(String[] args) throws Exception {
        if (args.length != 1) return 2;
        int secret = Integer.parseInt(Files.readString(Path.of(args[0])).trim());
        if (secret < 1 || secret > 1000) return 2;
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        System.out.println(1000);
        System.out.flush();
        int queries = 0;
        String line;
        while ((line = in.readLine()) != null) {
            String[] p = line.trim().split("\\\\s+");
            if (p.length != 2) return 1;
            int value;
            try { value = Integer.parseInt(p[1]); } catch (NumberFormatException e) { return 1; }
            if (value < 1 || value > 1000) return 1;
            if (p[0].equals("!")) return value == secret ? 0 : 1;
            if (!p[0].equals("?") || ++queries > 10) return 1;
            System.out.println(secret < value ? "SMALLER" : secret > value ? "LARGER" : "EQUAL");
            System.out.flush();
        }
        return 1;
    }
    public static void main(String[] args) throws Exception { System.exit(run(args)); }
}
`,
  javascript: `const fs = require("node:fs");
const readline = require("node:readline");
const secret = Number(fs.readFileSync(process.argv[2], "utf8").trim());
if (!Number.isInteger(secret) || secret < 1 || secret > 1000) process.exit(2);
let queries = 0;
const input = readline.createInterface({ input: process.stdin });
console.log(1000);
input.on("line", (line) => {
    const parts = line.trim().split(/\\s+/);
    const value = Number(parts[1]);
    if (parts.length !== 2 || !Number.isInteger(value) || value < 1 || value > 1000) process.exit(1);
    if (parts[0] === "!") process.exit(value === secret ? 0 : 1);
    if (parts[0] !== "?" || ++queries > 10) process.exit(1);
    console.log(secret < value ? "SMALLER" : secret > value ? "LARGER" : "EQUAL");
});
input.on("close", () => process.exit(1));
`,
};

export function isDefaultInteractorTemplate(source: string): boolean {
  return Object.values(INTERACTOR_SOURCE_TEMPLATES).some((template) => template.trim() === source.trim());
}

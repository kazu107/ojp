import { Language } from "@/lib/types";

export const SOURCE_CODE_TEMPLATES: Record<Language, string> = {
  cpp: [
    "#include <bits/stdc++.h>",
    "using namespace std;",
    "",
    "int main() {",
    "  ios::sync_with_stdio(false);",
    "  cin.tie(nullptr);",
    "",
    "  return 0;",
    "}",
  ].join("\n"),
  python: [
    "def solve():",
    "    pass",
    "",
    "",
    "if __name__ == '__main__':",
    "    solve()",
  ].join("\n"),
  java: [
    "import java.io.*;",
    "import java.util.*;",
    "",
    "public class Main {",
    "  public static void main(String[] args) throws Exception {",
    "  }",
    "}",
  ].join("\n"),
  javascript: [
    "'use strict';",
    "",
    "function main(input) {",
    "}",
    "",
    "main(require('fs').readFileSync(0, 'utf8'));",
  ].join("\n"),
};

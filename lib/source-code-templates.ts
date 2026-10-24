import { Language } from "@/lib/types";
import { BRAINFUCK_HELLO_WORLD } from "./brainfuck.js";

export const SOURCE_CODE_TEMPLATES: Record<Language, string> = {
  brainfuck: BRAINFUCK_HELLO_WORLD,
  c: "#include <stdio.h>\n\nint main(void) {\n  return 0;\n}\n",
  rust: "use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n    let mut tokens = input.split_whitespace();\n}\n",
  go: 'package main\n\nimport (\n    "bufio"\n    "fmt"\n    "os"\n)\n\nfunc main() {\n    in := bufio.NewReader(os.Stdin)\n    out := bufio.NewWriter(os.Stdout)\n    defer out.Flush()\n    // Example: var n int; fmt.Fscan(in, &n); fmt.Fprintln(out, n)\n    _ = in\n    _ = fmt.Fscan\n}\n',
  csharp: "using System;\nusing System.IO;\nusing System.Linq;\nusing System.Numerics;\n\npublic class MainClass {\n    public static void Main() {\n        var input = Console.In.ReadToEnd();\n    }\n}\n",
  kotlin: "import java.io.BufferedInputStream\n\nfun main() {\n    val input = BufferedInputStream(System.`in`)\n    val text = input.readBytes().toString(Charsets.UTF_8)\n}\n",
  ruby: "# frozen_string_literal: true\n\ninput = STDIN.read\n",
  pypy: "import sys\n\ndef solve():\n    data = sys.stdin.buffer.read().split()\n\nif __name__ == '__main__':\n    solve()\n",
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

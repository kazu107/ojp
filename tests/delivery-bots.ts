import { DELIVERY_PYTHON_TEMPLATE } from "../lib/delivery-templates";

export const deliveryTestBots = {
  greedy: { language: "python", sourceCode: DELIVERY_PYTHON_TEMPLATE },
  wait: { language: "javascript", sourceCode: `const input = require("node:readline").createInterface({ input: process.stdin });
let remaining = 0;
input.on("line", line => {
  if (!remaining) {
    if (line === "END") { input.close(); return; }
    const header = line.split(" ").map(Number);
    remaining = header[2] + header[11];
  } else if (!--remaining) {
    console.log("WAIT");
  }
});` },
  patrol: { language: "cpp", sourceCode: `#include <iostream>
#include <sstream>
#include <string>
int main() {
  std::string line;
  while (std::getline(std::cin, line) && line != "END") {
    std::istringstream row(line);
    int turn, seat, h, w, x, y, ox, oy, load, a, b, count;
    if (!(row >> turn >> seat >> h >> w >> x >> y >> ox >> oy >> load >> a >> b >> count)) return 1;
    for (int i = 0; i < h + count; ++i) std::getline(std::cin, line);
    std::cout << (turn % 16 < 8 ? "RIGHT" : "LEFT") << std::endl;
  }
}` },
  walk: { language: "ruby", sourceCode: `STDOUT.sync = true
steps = ["UP", "LEFT", "DOWN", "RIGHT"]
STDIN.each_line do |line|
  break if line.chomp == "END"
  fields = line.split.map(&:to_i)
  (fields[2] + fields[11]).times { STDIN.gets }
  puts steps[(fields[0] - 1) % 4]
end` },
  vertical: { language: "c", sourceCode: `#include <stdio.h>
#include <string.h>
int main(void) {
  char buf[256];
  int f[12];
  while (fgets(buf, sizeof buf, stdin) && strcmp(buf, "END\\n") != 0) {
    if (sscanf(buf,"%d%d%d%d%d%d%d%d%d%d%d%d", &f[0],&f[1],&f[2],&f[3],&f[4],&f[5],
      &f[6],&f[7],&f[8],&f[9],&f[10],&f[11]) != 12) return 1;
    for (int i=0; i < f[2]+f[11]; i++) if (!fgets(buf, sizeof buf, stdin)) return 1;
    puts(f[0] % 10 < 5 ? "UP" : "DOWN");
    fflush(stdout);
  }
  return 0;
}` },
  invalid: { language: "javascript", sourceCode: `process.stdin.once("data", () => console.log("INVALID"));` },
} as const;

import type { Language } from "./types";
import { SOURCE_CODE_TEMPLATES } from "./source-code-templates";
export const GRID_GAME_CHECKER_MARKER =
  "// Built-in grid game referee; rules are defined in config.json.\n";

const python = `while True:
    header = input()
    if header == "END":
        break
    h, w, turn, limit, x, y = map(int, header.split())
    board = [input() for _ in range(h)]
    # Choose UP, DOWN, LEFT, RIGHT, WAIT or STOP.
    print("RIGHT", flush=True)
`;
export const GRID_GAME_TEMPLATES: Record<Language, string> = {
  python,
  pypy: python,
  javascript: `const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
let state = null, board = [];
rl.on("line", line => {
  if (line === "END") { rl.close(); return; }
  if (!state) { state = line.split(/\\s+/).map(Number); board = []; return; }
  board.push(line);
  if (board.length === state[0]) {
    const [h, w, turn, limit, x, y] = state;
    console.log("RIGHT");
    state = null;
  }
});
`,
  cpp: `#include <iostream>
#include <string>
#include <vector>
using namespace std;
int main() {
  string header;
  while (cin >> header && header != "END") {
    int h=stoi(header),w,turn,limit,x,y;
    cin >> w >> turn >> limit >> x >> y;
    vector<string> board(h);
    for (auto &row: board) cin >> row;
    cout << "RIGHT" << endl;
  }
}
`,
  c: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
  char header[32], row[256];
  while(scanf("%31s",header)==1 && strcmp(header,"END")) {
    int h=atoi(header),w,turn,limit,x,y;
    if(scanf("%d%d%d%d%d",&w,&turn,&limit,&x,&y)!=5) return 1;
    for(int i=0;i<h;i++) if(scanf("%255s",row)!=1) return 1;
    puts("RIGHT"); fflush(stdout);
  }
  return 0;
}
`,
  java: `import java.io.*;
public class Main {
  public static void main(String[] args) throws Exception {
    BufferedReader in=new BufferedReader(new InputStreamReader(System.in));
    String line;
    while((line=in.readLine())!=null && !line.equals("END")) {
      String[] state=line.split(" ");
      int h=Integer.parseInt(state[0]);
      String[] board=new String[h];
      for(int i=0;i<h;i++) board[i]=in.readLine();
      System.out.println("RIGHT"); System.out.flush();
    }
  }
}
`,
  go: `package main
import("bufio"; "fmt"; "os")
func main(){
  in:=bufio.NewReader(os.Stdin); out:=bufio.NewWriter(os.Stdout)
  for { var header string; if _,err:=fmt.Fscan(in,&header);err!=nil||header=="END"{break}
    var h,w,turn,limit,x,y int; fmt.Sscan(header,&h); fmt.Fscan(in,&w,&turn,&limit,&x,&y)
    board:=make([]string,h); for i:=range board{fmt.Fscan(in,&board[i])}
    fmt.Fprintln(out,"RIGHT"); out.Flush()
  }
}
`,
  rust: `use std::io::{self, BufRead, Write};
fn main(){
  let stdin=io::stdin(); let mut lines=stdin.lock().lines();
  while let Some(Ok(header))=lines.next(){
    if header=="END"{break;}
    let state:Vec<usize>=header.split_whitespace().map(|v|v.parse().unwrap()).collect();
    let board:Vec<String>=(0..state[0]).map(|_|lines.next().unwrap().unwrap()).collect();
    let _=board;
    println!("RIGHT"); io::stdout().flush().unwrap();
  }
}
`,
  csharp: `using System;
class MainClass {
  static void Main(){
    string line;
    while((line=Console.ReadLine())!=null && line!="END"){
      string[] state=line.Split(' '); int h=int.Parse(state[0]);
      string[] board=new string[h]; for(int i=0;i<h;i++)board[i]=Console.ReadLine();
      Console.WriteLine("RIGHT");Console.Out.Flush();
    }
  }
}
`,
  kotlin: `fun main(){
  val input=System.\`in\`.bufferedReader()
  while(true){
    val header=input.readLine()?:break
    if(header=="END")break
    val state=header.split(" ").map{it.toInt()}
    val board=List(state[0]){input.readLine()}
    println("RIGHT");System.out.flush()
  }
}
`,
  ruby: `STDOUT.sync = true
while header = STDIN.gets
  break if header.strip == "END"
  h, w, turn, limit, x, y = header.split.map(&:to_i)
  board = Array.new(h) { STDIN.gets.strip }
  puts "RIGHT"
end
`,
  brainfuck: SOURCE_CODE_TEMPLATES.brainfuck,
};

export function gridGameTemplates(
  protocol: "moves" | "turns",
): Record<Language, string> {
  if (protocol === "turns") return GRID_GAME_TEMPLATES;
  const actions = "RIGHT RIGHT RIGHT RIGHT RIGHT";
  let cell = 0;
  const bf = Array.from(actions + "\n")
    .map((c) => {
      const value = c.charCodeAt(0),
        delta = value - cell;
      cell = value;
      return (delta >= 0 ? "+" : "-").repeat(Math.abs(delta)) + ".";
    })
    .join("");
  return {
    python: `print(${JSON.stringify(actions)})\n`,
    pypy: `print(${JSON.stringify(actions)})\n`,
    javascript: `console.log(${JSON.stringify(actions)});\n`,
    cpp: `#include <iostream>\nint main(){std::cout<<"${actions}\\n";}\n`,
    c: `#include <stdio.h>\nint main(void){puts("${actions}");return 0;}\n`,
    java: `public class Main {public static void main(String[] args){System.out.println("${actions}");}}\n`,
    go: `package main\nimport "fmt"\nfunc main(){fmt.Println("${actions}")}\n`,
    rust: `fn main(){println!("${actions}");}\n`,
    csharp: `using System;class MainClass{static void Main(){Console.WriteLine("${actions}");}}\n`,
    kotlin: `fun main(){println("${actions}")}\n`,
    ruby: `puts "${actions}"\n`,
    brainfuck: bf + "\n",
  };
}

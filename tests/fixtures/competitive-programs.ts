export const NEW_LANGUAGES = [
  "c",
  "rust",
  "go",
  "csharp",
  "kotlin",
  "ruby",
  "pypy",
] as const;
export type NewLanguage = (typeof NEW_LANGUAGES)[number];

export const SUM_PROGRAMS: Record<NewLanguage, string> = {
  c: '#include <stdio.h>\nint main(void) { long long a,b; if(scanf("%lld%lld",&a,&b)==2) printf("%lld\\n",a+b); return 0; }',
  rust: 'use std::io::{self,Read}; fn main(){let mut s=String::new();io::stdin().read_to_string(&mut s).unwrap();let a:Vec<i64>=s.split_whitespace().map(|v|v.parse().unwrap()).collect();println!("{}",a[0]+a[1]);}',
  go: 'package main\nimport("bufio";"fmt";"os")\nfunc main(){in:=bufio.NewReader(os.Stdin);var a,b int64;fmt.Fscan(in,&a,&b);fmt.Println(a+b)}',
  csharp:
    "using System; public class MainClass { public static void Main(){var a=Console.In.ReadToEnd().Split((char[])null,StringSplitOptions.RemoveEmptyEntries);Console.WriteLine(long.Parse(a[0])+long.Parse(a[1]));}}",
  kotlin:
    'fun main(){val a=System.`in`.bufferedReader().readText().trim().split(Regex("\\\\s+"));println(a[0].toLong()+a[1].toLong())}',
  ruby: "a=STDIN.read.split.map(&:to_i);puts a[0]+a[1]",
  pypy: "import sys\na,b=map(int,sys.stdin.buffer.read().split())\nprint(a+b)\n",
};

export const ECHO_PROGRAMS: Record<NewLanguage, string> = {
  c: "#include <stdio.h>\nint main(void){unsigned char b[8192];size_t n;while((n=fread(b,1,sizeof(b),stdin))>0)if(fwrite(b,1,n,stdout)!=n)return 1;return ferror(stdin)?1:0;}",
  rust: "use std::io; fn main(){io::copy(&mut io::stdin().lock(),&mut io::stdout().lock()).unwrap();}",
  go: 'package main\nimport("io";"os")\nfunc main(){io.Copy(os.Stdout,os.Stdin)}',
  csharp:
    "using System;class MainClass{static void Main(){Console.OpenStandardInput().CopyTo(Console.OpenStandardOutput());}}",
  kotlin: "fun main(){System.`in`.copyTo(System.out);System.out.flush()}",
  ruby: "STDIN.binmode;STDOUT.binmode;STDOUT.write(STDIN.read)",
  pypy: "import sys\nsys.stdout.buffer.write(sys.stdin.buffer.read())\n",
};

export const BAD_SYNTAX_PROGRAMS: Record<NewLanguage, string> = {
  c: "int main( {",
  rust: "fn main( {",
  go: "package main\nfunc main( {",
  csharp: "class MainClass {",
  kotlin: "fun main( {",
  ruby: "def main(",
  pypy: "def main(",
};
export const RUNTIME_ERROR_PROGRAMS: Record<NewLanguage, string> = {
  c: "int main(void){return 1;}",
  rust: 'fn main(){panic!("failure");}',
  go: 'package main\nfunc main(){panic("failure")}',
  csharp:
    'using System;class MainClass{static void Main(){throw new Exception("failure");}}',
  kotlin: 'fun main(){error("failure")}',
  ruby: 'raise "failure"',
  pypy: 'raise ValueError("failure")',
};
export const INFINITE_PROGRAMS: Record<NewLanguage, string> = {
  c: "int main(void){for(;;){}}",
  rust: "fn main(){loop{}}",
  go: "package main\nfunc main(){for{}}",
  csharp: "class MainClass{static void Main(){while(true){}}}",
  kotlin: "fun main(){while(true){}}",
  ruby: "loop {}",
  pypy: "while True:\n    pass\n",
};

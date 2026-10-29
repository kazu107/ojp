import type { Language } from "../../lib/types";

const python = `import sys
high = int(input())
low = 1
while low <= high:
    n = (low + high) // 2
    print("?", n, flush=True)
    response = input().strip()
    if response == "EQUAL":
        print("!", n, flush=True)
        break
    if response == "SMALLER":
        high = n - 1
    else:
        low = n + 1
`;

export const INTERACTIVE_SOLUTIONS: Record<Exclude<Language, "brainfuck">, string> = {
  python, pypy: python,
  javascript: `const rl=require('node:readline').createInterface({input:process.stdin});
let lo=1,hi=1000,n=0;
rl.on('line',s=>{if(s==='SMALLER')hi=n-1;else if(s==='LARGER')lo=n+1;else if(s==='EQUAL'){console.log('! '+n);rl.close();process.stdin.destroy();return;}
n=Math.floor((lo+hi)/2);console.log('? '+n);});`,
  cpp: `#include <iostream>
#include <string>
int main(){int lo=1,hi,n;std::string s;std::cin>>hi;while(lo<=hi){n=(lo+hi)/2;std::cout<<"? "<<n<<std::endl;if(!(std::cin>>s))return 1;if(s=="EQUAL"){std::cout<<"! "<<n<<std::endl;return 0;}if(s=="SMALLER")hi=n-1;else lo=n+1;}}`,
  c: `#include <stdio.h>
#include <string.h>
int main(){int lo=1,hi,n;char s[32];if(scanf("%d",&hi)!=1)return 1;while(lo<=hi){n=(lo+hi)/2;printf("? %d\\n",n);fflush(stdout);if(scanf("%31s",s)!=1)return 1;if(!strcmp(s,"EQUAL")){printf("! %d\\n",n);fflush(stdout);return 0;}if(!strcmp(s,"SMALLER"))hi=n-1;else lo=n+1;}}`,
  java: `import java.util.*; public class Main{public static void main(String[]args){Scanner in=new Scanner(System.in);int lo=1,hi=in.nextInt();while(lo<=hi){int n=(lo+hi)/2;System.out.println("? "+n);System.out.flush();String s=in.next();if(s.equals("EQUAL")){System.out.println("! "+n);System.out.flush();return;}if(s.equals("SMALLER"))hi=n-1;else lo=n+1;}}}`,
  rust: `use std::io::{self,BufRead,Write}; fn main(){let stdin=io::stdin();let mut lines=stdin.lock().lines();let mut hi:i32=lines.next().unwrap().unwrap().trim().parse().unwrap();let mut lo=1;while lo<=hi{let n=(lo+hi)/2;println!("? {}",n);io::stdout().flush().unwrap();let s=lines.next().unwrap().unwrap();if s=="EQUAL"{println!("! {}",n);io::stdout().flush().unwrap();return;}if s=="SMALLER"{hi=n-1}else{lo=n+1}}}`,
  go: `package main
import("fmt";"bufio";"os")
func main(){in:=bufio.NewReader(os.Stdin);out:=bufio.NewWriter(os.Stdout);lo,hi:=1,0;fmt.Fscan(in,&hi);for lo<=hi{n:=(lo+hi)/2;fmt.Fprintln(out,"?",n);out.Flush();var s string;fmt.Fscan(in,&s);if s=="EQUAL"{fmt.Fprintln(out,"!",n);out.Flush();return};if s=="SMALLER"{hi=n-1}else{lo=n+1}}}`,
  csharp: `using System;class MainClass{static void Main(){int lo=1,hi=int.Parse(Console.ReadLine());while(lo<=hi){int n=(lo+hi)/2;Console.WriteLine("? "+n);Console.Out.Flush();string s=Console.ReadLine();if(s=="EQUAL"){Console.WriteLine("! "+n);Console.Out.Flush();return;}if(s=="SMALLER")hi=n-1;else lo=n+1;}}}`,
  kotlin: `fun main(){val input=System.\`in\`.bufferedReader();var lo=1;var hi=input.readLine().toInt();while(lo<=hi){val n=(lo+hi)/2;println("? $n");System.out.flush();val s=input.readLine();if(s=="EQUAL"){println("! $n");System.out.flush();return};if(s=="SMALLER")hi=n-1 else lo=n+1}}`,
  ruby: `$stdout.sync=true
lo=1;hi=STDIN.gets.to_i
while lo<=hi
 n=(lo+hi)/2
 puts "? #{n}"
 s=STDIN.gets.strip
 if s=="EQUAL"
  puts "! #{n}"
  break
 end
 if s=="SMALLER" then hi=n-1 else lo=n+1 end
end`,
};

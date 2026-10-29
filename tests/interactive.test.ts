import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInteractiveCase } from "../lib/judge-interactive";
import { executePackageJudge } from "../lib/judge-runtime";
import { validateProblemPackage } from "../lib/problem-package";
import { INTERACTIVE_SOLUTIONS } from "./fixtures/interactive-programs";
import { INTERACTOR_SOURCE_TEMPLATES } from "../lib/interactor-source-templates";

const correct = INTERACTIVE_SOLUTIONS.javascript;

function data(interactor = INTERACTOR_SOURCE_TEMPLATES.javascript, secrets = [37, 1, 1000]) {
  const zip = new AdmZip();
  zip.addFile("statement.md", Buffer.from("# Guess"));
  zip.addFile("config.json", Buffer.from(JSON.stringify({
    judgeType: "interactive", interactorLanguage: "javascript", groups: ["group1"],
    timeLimitMs: 1000, memoryLimitMb: 256,
    interactive: { idleTimeLimitMs: 600, wallTimeLimitMs: 4000, interactorTimeLimitMs: 1000 },
  })));
  zip.addFile("interactor/Main.js", Buffer.from(interactor));
  secrets.forEach((secret, index) => zip.addFile(`tests/group1/case${index}.in`, Buffer.from(String(secret))));
  return validateProblemPackage("guess.zip", zip.toBuffer());
}

async function judge(sourceCode = correct, interactor?: string, secrets?: number[]) {
  let id = 0;
  return executePackageJudge({
    language: "javascript", sourceCode, timeLimitMs: 1000, memoryLimitMb: 256,
    packageData: data(interactor, secrets), nextTestResultId: () => `interactive-${++id}`,
  });
}

test("interactive binary search accepts different hidden cases and records bounded private traffic", async () => {
  const result = await judge();
  assert.equal(result.status, "accepted", JSON.stringify(result.testResults));
  assert.equal(result.score, 100);
  assert.equal(result.testResults.length, 3);
  for (const row of result.testResults) {
    assert.match(row.interactionLog!, /submission -> interactor/);
    assert.match(row.interactionLog!, /interactor -> submission/);
    assert.ok(Buffer.byteLength(row.interactionLog!) <= 16500);
  }
  assert.equal(result.totalTimeMs, Math.max(...result.testResults.map((row) => row.timeMs)));
});

test("interactive wrong answer is not overwritten by forced peer shutdown", async () => {
  const result = await judge("console.log('! 2');setInterval(()=>{},1000)", undefined, [37]);
  assert.equal(result.status, "wrong_answer", JSON.stringify(result.testResults));
});

test("initial output and EOF are preserved even when the submission terminates immediately", async()=>{
  const interactor="const fs=require('node:fs');const s=fs.readFileSync(0,'utf8');process.exit(s.trim()==='hello'?0:1)";
  const result=await judge("console.log('hello')",interactor,[37]);
  assert.equal(result.status,"accepted",JSON.stringify(result.testResults));
});

test("interactive query limit and malformed protocol are WA", async () => {
  for (const source of ["console.log('invalid')", "console.log(('? 500\\n').repeat(11))"]) {
    assert.equal((await judge(source, undefined, [37])).status, "wrong_answer");
  }
});

test("interactive flush omission/deadlock is bounded by idle timeout", async () => {
  const result = await judge("process.stdin.resume();setInterval(()=>{},1000)", undefined, [37]);
  assert.equal(result.status, "time_limit_exceeded");
  assert.match(result.testResults[0].message, /idle timeout/);
});

test("interactive crashes are RE, premature EOF is WA", async () => {
  assert.equal((await judge("throw Error('crash')", undefined, [37])).status, "runtime_error");
  assert.equal((await judge("process.exit(0)", undefined, [37])).status, "wrong_answer");
});

test("interactor crash and compilation failure are IE and never reveal stderr in public messages", async () => {
  const result = await judge(correct, "console.error('private-secret-37');process.exit(2)", [37]);
  assert.equal(result.status, "internal_error");
  assert.doesNotMatch(result.testResults[0].message, /private-secret/);
  assert.match(result.testResults[0].interactionLog!, /private-secret/);
  assert.equal((await judge(correct, "this is not valid javascript!", [37])).status, "internal_error");
});

test("interactive unlimited traffic respects the overall wall deadline even when idle timer is reset", async () => {
  const packageData = data("process.stdin.on('data',b=>process.stdout.write(b));console.log('x')", [37]);
  packageData.interactive = { idleTimeLimitMs: 500, wallTimeLimitMs: 700, interactorTimeLimitMs: 2000 };
  let id=0;
  const result = await executePackageJudge({ language: "javascript", sourceCode: "process.stdin.on('data',b=>process.stdout.write(b))", timeLimitMs: 2000, memoryLimitMb: 256, packageData, nextTestResultId:()=>String(++id) });
  assert.equal(result.status, "time_limit_exceeded");
  assert.ok(Buffer.byteLength(result.testResults[0].interactionLog!) <= 16500);
});

test("interactive Brainfuck flushes before reading the next response", async () => {
  const packageData = data("const fs=require('node:fs');process.stdout.write('A');const b=Buffer.alloc(1);fs.readSync(0,b);if(b[0]!==65)process.exit(1);process.stdout.write('\\0');", [37]);
  let id=0;
  const result = await executePackageJudge({ language: "brainfuck", sourceCode: ",[.,]", timeLimitMs: 1000, memoryLimitMb: 256, packageData, nextTestResultId:()=>String(++id) });
  assert.equal(result.status, "accepted", JSON.stringify(result.testResults));
});

test("interactive output floods are bounded and classified as submission RE", async () => {
  const result = await judge("process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000)", undefined, [37]);
  assert.equal(result.status, "runtime_error", JSON.stringify(result.testResults));
});

test("resumed interactive judging preserves finished cases without re-running or duplicating them", async () => {
  const packageData = data(undefined, [37, 1000]);
  const initialData = data(undefined,[37]);
  let id=0;
  const initial=await executePackageJudge({language:"javascript",sourceCode:correct,timeLimitMs:1000,memoryLimitMb:256,packageData:initialData,nextTestResultId:()=>String(++id)});
  let newCases=0;
  const resumed=await executePackageJudge({language:"javascript",sourceCode:correct,timeLimitMs:1000,memoryLimitMb:256,packageData,existingResults:initial.testResults,nextTestResultId:()=>String(++id),onTestResult:()=>{newCases++}});
  assert.equal(resumed.status,"accepted");
  assert.equal(newCases,1);
  assert.deepEqual(resumed.testResults[0],initial.testResults[0]);
  assert.equal(new Set(resumed.testResults.map(row=>row.groupName+row.testCaseName)).size,2);
});

test("interactive groups retain partial scoring", async()=>{
  const packageData=data(undefined,[37,1000]);
  const cases=packageData.groups[0].tests;
  packageData.scoringType="sum_of_groups";
  packageData.groups=[{name:"easy",score:30,orderIndex:0,tests:[cases[0]]},{name:"hard",score:70,orderIndex:1,tests:[cases[1]]}];
  let id=0;
  const result=await executePackageJudge({language:"javascript",sourceCode:"console.log('! 37')",timeLimitMs:1000,memoryLimitMb:256,packageData,nextTestResultId:()=>String(++id)});
  assert.equal(result.status,"wrong_answer");
  assert.equal(result.score,30);
});

test("cancelling interactive execution terminates both peers and releases their pipes", async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"ojp-interactive-cancel-"));
  const controller=new AbortController();
  try {
    for (const name of ["a","b"]) {
      await mkdir(path.join(directory,name));
      await writeFile(path.join(directory,name,"main.js"),"require('node:fs').writeFileSync('pid.txt',String(process.pid));process.stdin.resume();setInterval(()=>{},1000)");
    }
    await writeFile(path.join(directory,"input.txt"),"37");
    const job=runInteractiveCase({contestant:{commands:[process.execPath],args:["main.js"],cwd:path.join(directory,"a")},interactor:{commands:[process.execPath],args:["main.js"],cwd:path.join(directory,"b")},inputPath:path.join(directory,"input.txt"),timeLimitMs:2000,memoryLimitMb:256,limits:{idleTimeLimitMs:3000,wallTimeLimitMs:5000,interactorTimeLimitMs:2000},signal:controller.signal});
    const pids:number[]=[];
    for (const name of ["a","b"]) {
      for(let attempt=0;attempt<100;attempt++) {
        try { pids.push(Number(await readFile(path.join(directory,name,"pid.txt"),"utf8"))); break; }
        catch { await new Promise(resolve=>setTimeout(resolve,10)); }
      }
    }
    controller.abort();
    const result=await job;
    assert.equal(result.verdict,"internal_error");
    assert.match(result.message,/cancelled/);
    assert.equal(pids.length,2);
    for (const pid of process.env.JUDGE_SANDBOX === "bubblewrap" ? [] : pids) {
      try {
        process.kill(pid,0);
        const status=await readFile(`/proc/${pid}/status`,"utf8");
        assert.match(status,/State:\s+Z/);
      } catch (error) {
        if (!["ESRCH","ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
    }
  } finally { controller.abort(); await rm(directory,{recursive:true,force:true}); }
});

test("interactor waiting time is not charged as contestant CPU time", {skip:process.platform!=="linux"}, async()=>{
  const slow=INTERACTOR_SOURCE_TEMPLATES.javascript.replace('console.log(secret < value ? "SMALLER" : secret > value ? "LARGER" : "EQUAL");','setTimeout(()=>console.log(secret < value ? "SMALLER" : secret > value ? "LARGER" : "EQUAL"),150);');
  let id=0;
  const result=await executePackageJudge({language:"javascript",sourceCode:correct,timeLimitMs:200,memoryLimitMb:256,packageData:data(slow,[37]),nextTestResultId:()=>String(++id)});
  assert.equal(result.status,"accepted",JSON.stringify(result.testResults));
  assert.ok(result.totalTimeMs<=200);
});

test("interactor CPU overrun is IE rather than contestant TLE", {skip:process.platform!=="linux"}, async()=>{
  const packageData=data("while(true){}",[37]);
  packageData.interactive={idleTimeLimitMs:2000,wallTimeLimitMs:4000,interactorTimeLimitMs:200};
  let id=0;
  const result=await executePackageJudge({language:"javascript",sourceCode:correct,timeLimitMs:1000,memoryLimitMb:256,packageData,nextTestResultId:()=>String(++id)});
  assert.equal(result.status,"internal_error",JSON.stringify(result.testResults));
});

test("contestant RSS overrun is MLE rather than an interactor failure", {skip:process.platform!=="linux"}, async()=>{
  let id=0;
  const result=await executePackageJudge({language:"javascript",sourceCode:"const data=Buffer.alloc(64*1024*1024,1);setInterval(()=>console.error(data[0]),1000)",timeLimitMs:1000,memoryLimitMb:48,packageData:data(undefined,[37]),nextTestResultId:()=>String(++id)});
  assert.equal(result.status,"memory_limit_exceeded",JSON.stringify(result.testResults));
});

for (const language of ["cpp", "python", "java", "c", "rust", "go", "csharp", "kotlin", "ruby", "pypy"] as const) {
  test("interactive solution language " + language, {skip:process.platform!=="linux"}, async()=>{
    let id=0;
    const result=await executePackageJudge({language,sourceCode:INTERACTIVE_SOLUTIONS[language],timeLimitMs:2000,memoryLimitMb:256,packageData:data(undefined,[37]),nextTestResultId:()=>String(++id)});
    assert.equal(result.status,"accepted",JSON.stringify(result.testResults));
  });
}
for (const checkerLanguage of ["cpp", "python", "java"] as const) {
  test("interactor template language " + checkerLanguage, {skip:process.platform!=="linux"}, async()=>{
    const packageData=data(undefined,[37]);
    packageData.checkerLanguage=checkerLanguage;
    packageData.checkerSourceCode=INTERACTOR_SOURCE_TEMPLATES[checkerLanguage];
    let id=0;
    const result=await executePackageJudge({language:"javascript",sourceCode:correct,timeLimitMs:2000,memoryLimitMb:256,packageData,nextTestResultId:()=>String(++id)});
    assert.equal(result.status,"accepted",JSON.stringify(result.testResults));
  });
}

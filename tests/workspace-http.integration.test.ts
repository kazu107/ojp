import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { encode } from "next-auth/jwt";
import AdmZip from "adm-zip";

test("disposable HTTP: tags, private notes, pinned judging, history restore and rejudge selection", {
  skip: !process.env.WORKSPACE_TEST_ORIGIN, timeout:180000,
}, async()=>{
  assert.equal(process.env.WORKSPACE_TEST_ORIGIN,"http://127.0.0.1:3102");
  const url=new URL(process.env.WORKSPACE_TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1","localhost"].includes(url.hostname)&&url.pathname==="/ojp_workspace_test","Refusing a non-test database");
  const origin=process.env.WORKSPACE_TEST_ORIGIN!;
  const cookie=async(login:string)=>`authjs.session-token=${await encode({secret:"workspace-local-validation-only",salt:"authjs.session-token",token:{sub:login,oauthProvider:"github",oauthAccountId:login,oauthLogin:login,oauthName:login},maxAge:3600})}`;
  const admin=await cookie("workspace-test"),alice=await cookie("workspace-alice"),bob=await cookie("workspace-bob");
  async function request(path:string,auth?:string,method="GET",body?:unknown,status=200){
    const response=await fetch(origin+path,{method,headers:{...(auth?{Cookie:auth}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
    const value=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(value)}`);return value;
  }
  async function until(read:()=>Promise<unknown>,predicate:(value:any)=>boolean){ // eslint-disable-line @typescript-eslint/no-explicit-any
    const deadline=Date.now()+45000;let value:unknown;
    do {value=await read();if(predicate(value))return value as {submission:{status:string;score:number;problemRevisionId:string;judgeRevisionId:string}};await new Promise(resolve=>setTimeout(resolve,300));}while(Date.now()<deadline);
    throw new Error("Timed out: "+JSON.stringify(value));
  }
  let worker:ChildProcess|undefined;
  function startWorker(){worker=spawn(process.execPath,["--import","tsx","scripts/judge-worker.ts"],{cwd:process.cwd(),windowsHide:true,stdio:"ignore",env:{...process.env,DATABASE_URL:url.toString(),JUDGE_PROCESS_MODE:"worker",STORE_DB_SYNC:"1",JUDGE_SANDBOX:"basic",R2_BUCKET:"",R2_ACCOUNT_ID:"",R2_ENDPOINT:"",R2_ACCESS_KEY_ID:"",R2_SECRET_ACCESS_KEY:""}});}
  async function stopWorker(){if(!worker||worker.exitCode!==null)return;const child=worker;const closed=new Promise(resolve=>child.once("exit",resolve));child.kill();await closed;worker=undefined;}
  try{
    assert.equal((await request("/api/me",admin)).user.role,"admin");await request("/api/me",alice);await request("/api/me",bob);
    const suffix=Date.now();
    const p=(await request("/api/problems",admin,"POST",{title:"Workspace Sum",slug:`workspace-${suffix}`,visibility:"public",statementMarkdown:"Read a and b.",difficulty:800,timeLimitMs:1500,memoryLimitMb:128},201)).problem;
    await request(`/api/problems/${p.id}/tags`,admin,"PUT",{tags:[" DP","graph","ＤＰ"]});
    assert.deepEqual((await request(`/api/problems/${p.id}/tags`,admin)).tags,["dp","graph"]);
    await request(`/api/problems/${p.id}/tags`,alice,"PUT",{tags:["hack"]},403);
    const zip=(answer:string)=>{const value=new AdmZip();value.addFile("statement.md",Buffer.from("# Sum\nRead a and b."));value.addFile("config.json",Buffer.from(JSON.stringify({timeLimitMs:1500,memoryLimitMb:128,groups:["g"]})));for(const base of ["samples/s","tests/g/c"]){value.addFile(base+".in",Buffer.from("2 3\n"));value.addFile(base+".out",Buffer.from(answer+"\n"));}return value.toBuffer()};
    async function upload(answer:string){const data=new FormData();data.set("file",new Blob([new Uint8Array(zip(answer))]),"sum.zip");const r=await fetch(`${origin}/api/problems/${p.id}/package`,{method:"POST",headers:{Cookie:admin},body:data});assert.equal(r.status,201,await r.text());}
    await upload("5");
    await request(`/api/problems/${p.id}/study`,alice,"PUT",{bookmarked:true,review:true,reviewAt:"2020-01-01T00:00:00+09:00",notes:"alice-private-marker"});
    assert.equal((await request(`/api/problems/${p.id}/study`,bob)).study,null);
    assert.equal((await request(`/api/problems/${p.id}/study`,alice)).study.notes,"alice-private-marker");
    assert.equal((await request("/api/problems?tag=dp&min=400&max=1000",undefined)).problems.some((row:{id:string})=>row.id===p.id),true);
    assert.equal((await request("/api/problems?saved=1",alice)).problems.some((row:{id:string})=>row.id===p.id),true);
    assert.equal((await request("/api/problems?saved=1",bob)).problems.some((row:{id:string})=>row.id===p.id),false);
    await request("/api/problems?saved=1",undefined,"GET",undefined,401);
    await request(`/api/problems/${p.id}/revisions`,alice,"GET",undefined,403);
    const submission=(await request("/api/submissions",admin,"POST",{problemId:p.id,language:"javascript",sourceCode:"console.log(5)"},201)).submission;
    assert.ok(submission.problemRevisionId);const original=submission.problemRevisionId;
    // No worker has run: change the live package before the queued job is claimed.
    await request(`/api/problems/${p.id}`,admin,"PATCH",{title:"Changed title"});
    await request(`/api/problems/${p.id}/tags`,admin,"PUT",{tags:["math"]});await upload("6");
    startWorker();
    const accepted=await until(()=>request(`/api/submissions/${submission.id}`,admin),r=>r.submission.status==="accepted");
    assert.equal(accepted.submission.score,100);assert.equal(accepted.submission.judgeRevisionId,original);
    // Worker completion and runtime finalization are separate; wait for its job ack.
    await new Promise(resolve=>setTimeout(resolve,1200));
    await request(`/api/submissions/${submission.id}/rejudge`,admin,"POST",{reason:"testcase fix",detail:"latest",revision:"latest"});
    const wrong=await until(()=>request(`/api/submissions/${submission.id}`,admin),r=>r.submission.status==="wrong_answer");
    assert.notEqual(wrong.submission.judgeRevisionId,original);assert.equal(wrong.submission.problemRevisionId,original);
    await new Promise(resolve=>setTimeout(resolve,1200));
    await request(`/api/submissions/${submission.id}/rejudge`,admin,"POST",{reason:"manual review",detail:"original",revision:"original"});
    await until(()=>request(`/api/submissions/${submission.id}`,admin),r=>r.submission.status==="accepted");
    await request(`/api/problems/${p.id}/revisions`,admin,"POST",{revisionId:original});
    const legacy=await request("/api/problems/p1000/package/manifest",admin);assert.ok(legacy.draft.groups.length>0);
    assert.equal((await request(`/api/problems/${p.id}`,admin)).problem.title,"Workspace Sum");
    assert.deepEqual((await request(`/api/problems/${p.id}/tags`,admin)).tags,["dp","graph"]);
    const history=await request(`/api/problems/${p.id}/revisions`,admin);assert.ok(history.revisions.length>=3);assert.ok(history.revisions.some((row:{id:string})=>row.id===original));assert.ok(!JSON.stringify(history).includes('"inlinePackage"'));
    assert.equal((await request("/api/problems?progress=solved",admin)).problems.some((row:{id:string})=>row.id===p.id),true);
    await request(`/api/problems/${p.id}/study`,alice,"PUT",{reviewed:true});assert.equal((await request(`/api/problems/${p.id}/study`,alice)).study.review,false);
    const html=await(await fetch(origin+`/problems/${p.id}`,{headers:{Cookie:bob}})).text();assert.ok(!html.includes("alice-private-marker"));
    const privateProblem=(await request("/api/problems",admin,"POST",{title:"Secret Problem",slug:`workspace-secret-${suffix}`,visibility:"private",statementMarkdown:"private"},201)).problem;
    await request(`/api/problems/${privateProblem.id}/tags`,admin,"PUT",{tags:["private-tag"]});
    assert.equal((await request("/api/problems?tag=private-tag",bob)).problems.length,0);
    await request(`/api/problems/${privateProblem.id}/study`,bob,"PUT",{bookmarked:true},404);
    const notes=await fetch(origin+"/review?view=all",{headers:{Cookie:alice}});assert.equal(notes.status,200);assert.ok((await notes.text()).includes("Workspace Sum"));
    for(let index=0;index<51;index++)await request(`/api/problems/${p.id}/tags`,admin,"PUT",{tags:[`history-${index}`]});
    const page1=await request(`/api/problems/${p.id}/revisions`,admin);assert.equal(page1.revisions.length,50);assert.ok(page1.nextCursor);
    const page2=await request(`/api/problems/${p.id}/revisions?cursor=${page1.nextCursor}`,admin);assert.ok(page2.revisions.some((row:{id:string})=>row.id===original));
    await request(`/api/problems/${p.id}/revisions`,admin,"POST",{revisionId:original});
  }finally{await stopWorker()}
});

import test from "node:test";
import assert from "node:assert/strict";
import { filterProblems, normalizeTags, problemProgress } from "../lib/problem-discovery";
import { makeRevisionSnapshot, revisionDigest, revisionSummary, revisionChanges } from "../lib/problem-revisions";
import { studyPatch } from "../lib/problem-workspace-store";
import { readWorkspaceBody } from "../lib/workspace-json";
import type { Problem } from "../lib/types";
import { buildProblemPackageZipBlob } from "../lib/problem-package-client-zip";
import { buildProblemPackageZip, inspectProblemPackage } from "../lib/problem-package";
import { inspectProblemPackageClient } from "../lib/problem-package-client-inspect";

const p:Problem={id:"p1",authorId:"u1",title:"Graph Paths",slug:"graph",statementMarkdown:"old",inputDescription:"",outputDescription:"",constraintsMarkdown:"",explanationMarkdown:"secret",explanationVisibility:"private",visibility:"public",difficulty:800,timeLimitMs:1000,memoryLimitMb:256,scoringType:"binary",testCaseVisibility:"case_index_only",latestPackageSummary:null,sampleCases:[],createdAt:"2026-01-01",updatedAt:"2026-01-01"};
test("tags normalize Unicode, deduplicate and reject malformed input",()=>{
  assert.deepEqual(normalizeTags(" DP,ｄｐ,グラフ、 graph "),["dp","graph","グラフ"]);
  assert.deepEqual(normalizeTags("ＤＰ，ｇｒａｐｈ"),["dp","graph"]);
  assert.throws(()=>normalizeTags(["dp,graph"]));
  assert.throws(()=>normalizeTags(["<script>"]));assert.throws(()=>normalizeTags(Array(21).fill("x")));assert.throws(()=>normalizeTags([5]));
});
test("discovery combines tag, text, difficulty, progress and private bookmark predicates",()=>{
  const all=[p,{...p,id:"p2",title:"Math",slug:"math",difficulty:null},{...p,id:"p3",difficulty:1200}];
  const tags=new Map([["p1",["graph","dp"]],["p3",["graph"]]]);
  const progress=problemProgress([{problemId:"p1",status:"wrong_answer"},{problemId:"p1",status:"accepted"},{problemId:"p1",status:"wrong_answer"},{problemId:"p3",status:"wrong_answer"}]);
  assert.equal(progress.get("p1"),"solved");
  assert.deepEqual(filterProblems(all,{q:"ＧＲＡＰＨ",min:"400",max:"1000",progress:"solved",saved:"1"},tags,progress,new Set(["p1"])).map(row=>row.id),["p1"]);
  assert.deepEqual(filterProblems(all,{progress:"unattempted"},tags,progress).map(row=>row.id),["p2"]);
  assert.equal(filterProblems(all,{tag:"graph",progress:"attempted"},tags,progress)[0].id,"p3");
});
test("revision hashes are stable across timestamps and key ordering but pin limits, tags and package",()=>{
  const original=makeRevisionSnapshot(p,null,null,["dp"]);
  assert.equal(revisionDigest(original),revisionDigest({...original,problem:{...p,updatedAt:"new"}}));
  const next=makeRevisionSnapshot({...p,title:"changed",memoryLimitMb:512},null,null,["graph"]);
  assert.notEqual(revisionDigest(original),revisionDigest(next));
  assert.deepEqual(revisionChanges(revisionSummary(original),revisionSummary(next)).map(row=>row.field),["title","memoryLimitMb","tags"]);
  const ref={provider:"r2" as const,bucket:"test",key:"immutable/a.zip",uploadedAt:"now",sizeBytes:12,etag:"a"};
  const snapshot=makeRevisionSnapshot({...p,sampleCases:[{name:"x",input:"large",output:"",description:""}]},ref,null);
  assert.deepEqual(snapshot.problem.sampleCases,[]);
  assert.notEqual(revisionDigest(snapshot),revisionDigest({...snapshot,storageRef:{...ref,key:"immutable/b.zip"}}));
  const unicode=revisionSummary(makeRevisionSnapshot({...p,statementMarkdown:"a".repeat(399)+"\u{1f600}tail"},null,null));
  assert.equal(unicode.statementMarkdown.value,"a".repeat(399)+"\u{1f600}");
});
test("study values reject oversized notes and preserve explicit false; reviewing clears due state",()=>{
  assert.deepEqual(studyPatch({bookmarked:false,review:false,notes:"private"}),{bookmarked:false,review:false,notes:"private"});
  assert.throws(()=>studyPatch({notes:"x".repeat(10001)}));assert.throws(()=>studyPatch({reviewAt:"bad"}));assert.throws(()=>studyPatch({bookmarked:1}));
  const result=studyPatch({review:true,reviewed:true,reviewAt:"2030-01-01"});
  assert.equal(result.review,false);assert.equal(result.reviewAt,null);assert.ok(result.lastReviewedAt instanceof Date);
});
test("workspace request limits also work without Content-Length and reject arrays",async()=>{
  assert.deepEqual(await readWorkspaceBody(new Request("http://localhost",{method:"PUT",body:JSON.stringify({notes:"日本語"})})),{notes:"日本語"});
  await assert.rejects(readWorkspaceBody(new Request("http://localhost",{method:"PUT",body:"[]"})),/JSON object/);
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode("x".repeat(100)));controller.close()}});
  const request=new Request("http://localhost",{method:"PUT",body,duplex:"half"} as RequestInit & {duplex:"half"});
  await assert.rejects(readWorkspaceBody(request,20),/too large/);
});
test("tags round trip through both ZIP builders and both inspectors",async()=>{
  const input={...p,tags:[" DP","グラフ"],draft:{sourceLabel:"sum",checkerType:"exact" as const,checkerLanguage:"python" as const,checkerSourceCode:"",compareMode:"exact" as const,zipSizeBytes:0,fileCount:0,warnings:[],samples:[{id:"s",name:"s",description:"",input:"1",output:"1"}],groups:[{id:"g",name:"g",score:null,tests:[{id:"c",name:"c",input:"1",output:"1"}]}]}};
  const files=[buildProblemPackageZip(input),Buffer.from(await(await buildProblemPackageZipBlob(input)).arrayBuffer())];
  for(const buffer of files){
    assert.deepEqual(inspectProblemPackage("tagged.zip",buffer).prefill.tags,["dp","グラフ"]);
    const file=Object.assign(Buffer.from(buffer),{name:"tagged.zip",size:buffer.length}) as unknown as File;
    assert.deepEqual((await inspectProblemPackageClient(file)).prefill.tags,["dp","グラフ"]);
  }
});

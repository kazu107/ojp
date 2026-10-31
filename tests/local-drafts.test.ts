import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { DRAFT_TTL_MS, draftFits, readLocalDraft, writeLocalDraft, removeLocalDraft, validDraft, type LocalDraft } from "../lib/local-drafts";
import { recoverablePackage, mergeRecoveredPackage } from "../lib/problem-drafts";
import type { ProblemPackageEditorDraft } from "../lib/problem-package-types";

test("drafts survive reconnect, are owner-scoped and expire", async () => {
  const row: LocalDraft = { key:"alice:submission:p1",owner:"alice",writer:"tab-a",updatedAt:Date.now(),base:"v1",data:{source:"print(1)"} };
  await writeLocalDraft(row,null);
  assert.deepEqual((await readLocalDraft(row.key,"alice"))?.data,row.data);
  assert.equal(await readLocalDraft(row.key,"bob"),null);
  assert.equal(validDraft(row,"alice",row.updatedAt+DRAFT_TTL_MS),false);
  assert.equal(validDraft({...row,updatedAt:Date.now()+120000},"alice"),false);
  await removeLocalDraft(row.key);assert.equal(await readLocalDraft(row.key,"alice"),null);
});
test("a second tab cannot overwrite an unseen draft; explicit recovery allows a later save",async()=>{
  const row:LocalDraft={key:"alice:problem:p1",owner:"alice",writer:"a",base:"v1",updatedAt:Date.now(),data:"first"};
  await writeLocalDraft(row,null);
  await assert.rejects(writeLocalDraft({...row,writer:"b",updatedAt:row.updatedAt+1,data:"overwrite"},null),/Another tab/);
  assert.equal((await readLocalDraft(row.key,"alice"))?.data,"first");
  await writeLocalDraft({...row,writer:"b",updatedAt:row.updatedAt+2,data:"recovered"},row.updatedAt);
  assert.equal((await readLocalDraft(row.key,"alice"))?.data,"recovered");
});
test("oversized drafts do not destroy the last valid draft and clear is ordered after pending writes",async()=>{
  const row:LocalDraft={key:"alice:ordered",owner:"alice",writer:"a",base:"v1",updatedAt:Date.now(),data:"valid"};
  await writeLocalDraft(row,null);
  assert.equal(draftFits("x".repeat(3*1024*1024)),false);
  await assert.rejects(writeLocalDraft({...row,data:"x".repeat(3*1024*1024)},row.updatedAt),/too large/);
  assert.equal((await readLocalDraft(row.key,"alice"))?.data,"valid");
  await Promise.all([writeLocalDraft({...row,data:"pending",updatedAt:row.updatedAt+1},row.updatedAt),removeLocalDraft(row.key)]);
  assert.equal(await readLocalDraft(row.key,"alice"),null);
});
test("large ZIP data is omitted, small edits survive, and missing original cases fail closed",()=>{
  const original:ProblemPackageEditorDraft={sourceLabel:"large.zip",checkerType:"interactive",checkerLanguage:"python",checkerSourceCode:"checker",compareMode:"exact",zipSizeBytes:1000,fileCount:4,warnings:[],samples:[],groups:[{id:"g",name:"group1",score:null,tests:[{id:"a",name:"large",input:"x".repeat(1024*1024),output:"",isLoaded:true},{id:"b",name:"edited",input:"small edit",output:"",isLoaded:true}]}]};
  const saved=JSON.parse(JSON.stringify(recoverablePackage(original))) as ProblemPackageEditorDraft;
  assert.ok(saved.recoveryNeedsReimport);assert.equal(saved.groups[0].tests[0].input,"");
  assert.ok(JSON.stringify(saved).length<10000);
  assert.equal(original.groups[0].tests[0].input.length,1024*1024);
  const merged=mergeRecoveredPackage(saved,original);
  assert.equal(merged.groups[0].tests[0].input.length,1024*1024);
  assert.equal(merged.groups[0].tests[1].input,"small edit");assert.equal(merged.recoveryNeedsReimport,false);
  assert.throws(()=>mergeRecoveredPackage(saved,{...original,groups:[]}),/does not contain/);
});

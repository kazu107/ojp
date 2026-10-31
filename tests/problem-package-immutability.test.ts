import test from "node:test";
import assert from "node:assert/strict";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, putProblemPackageZip, getProblemPackageZip, getProblemPackageZipStream } from "../lib/problem-package-storage";

test("new R2 keys never overwrite each other and reads enforce the pinned ETag",async(t)=>{
  Object.assign(process.env,{R2_BUCKET:"unit-test",R2_ENDPOINT:"https://unit.invalid",R2_ACCESS_KEY_ID:"unit-test",R2_SECRET_ACCESS_KEY:"unit-test"});
  const client=getR2Client();const puts:PutObjectCommand[]=[];const gets:GetObjectCommand[]=[];
  t.mock.method(client,"send",async(command:unknown)=>{
    if(command instanceof PutObjectCommand){puts.push(command);return {ETag:'"v1"'}}
    if(command instanceof GetObjectCommand){
      gets.push(command);if(command.input.IfMatch==='"tampered"')throw new Error("PreconditionFailed");
      return {Body:{transformToByteArray:async()=>new Uint8Array([1,2]),transformToWebStream:()=>new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([1,2]));controller.close()}})}};
    }
    throw new Error("Unexpected network operation");
  });
  const a=await putProblemPackageZip({problemId:"p",fileName:"same.zip",zipBuffer:Buffer.from([1,2])});
  const b=await putProblemPackageZip({problemId:"p",fileName:"same.zip",zipBuffer:Buffer.from([1,2])});
  assert.notEqual(a.key,b.key);assert.ok(puts.every(command=>command.input.IfNoneMatch==="*"));
  assert.deepEqual(await getProblemPackageZip(a),Buffer.from([1,2]));
  assert.deepEqual(await new Response(await getProblemPackageZipStream(a)).arrayBuffer(),new Uint8Array([1,2]).buffer);
  assert.ok(gets.every(command=>command.input.IfMatch==='"v1"'));
  await assert.rejects(getProblemPackageZip({...a,etag:'"tampered"'}),/PreconditionFailed/);
  await getProblemPackageZip({...a,etag:null});assert.equal(gets.at(-1)?.input.IfMatch,undefined);
});

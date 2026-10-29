import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { buildEditorDraftFromExtracted, buildProblemPackageZip, inspectProblemPackageManifestFromZip, buildEditorDraftManifestFromZip, validateProblemPackage, readProblemPackageTestCaseFromZip } from "../lib/problem-package";
import { buildProblemPackageZipBlob } from "../lib/problem-package-client-zip";
import { inspectProblemPackageClient } from "../lib/problem-package-client-inspect";
import { createLazyProblemPackageSourceFromBuffer } from "../lib/problem-package-lazy";
import { INTERACTOR_SOURCE_TEMPLATES } from "../lib/interactor-source-templates";
import { parseInteractiveLimits } from "../lib/interactive-config";
import { visibleInteractionResults, canViewPrivateInteraction } from "../lib/interactive-privacy";

function zipData() {
  const zip = new AdmZip();
  zip.addFile("statement.md", Buffer.from("# Guess\n\nFind the secret."));
  zip.addFile("config.json", Buffer.from(JSON.stringify({ judgeType: "interactive", interactorLanguage: "python", timeLimitMs: 1000, memoryLimitMb: 256, groups: [{ name: "group1", score: 100 }], interactive: { idleTimeLimitMs: 700, wallTimeLimitMs: 3000 } })));
  zip.addFile("tests/group1/case01.in", Buffer.from("37\r\n"));
  zip.addFile("samples/sample01.interaction", Buffer.from("< 1000\n> ? 37\n< EQUAL\n> ! 37\n"));
  zip.addFile("interactor/Main.py", Buffer.from(INTERACTOR_SOURCE_TEMPLATES.python));
  return zip.toBuffer();
}

const metadata = {
  title: "Guess", slug: "guess", visibility: "private" as const, explanationVisibility: "private" as const,
  difficulty: null, testCaseVisibility: "case_index_only" as const,
  statementMarkdown: "Find the secret.", inputDescription: "Interactive", outputDescription: "Flush", constraintsMarkdown: "", explanationMarkdown: "",
  timeLimitMs: 1000, memoryLimitMb: 256,
};

test("interactive packages accept .in-only tests and interaction samples in eager and manifest paths", () => {
  const zip = zipData();
  const extracted = validateProblemPackage("guess.zip", zip);
  assert.equal(extracted.checkerType, "interactive");
  assert.equal(extracted.groups[0].tests[0].output, "");
  assert.equal(extracted.groups[0].tests[0].input, "37\n");
  assert.match(extracted.samples[0].interaction!, /> ! 37/);
  assert.equal(extracted.interactive?.idleTimeLimitMs, 700);
  assert.equal(inspectProblemPackageManifestFromZip("guess.zip", zip).interactive?.idleTimeLimitMs, 700);
  const draft = buildEditorDraftManifestFromZip("guess.zip", zip);
  assert.equal(draft.checkerType, "interactive");
  assert.equal(draft.interactive?.idleTimeLimitMs, 700);
  assert.match(draft.samples[0].interaction!, /EQUAL/);
  assert.equal(readProblemPackageTestCaseFromZip("guess.zip", zip, {groupName:"group1",caseName:"case01"}).output, "");
});

test("server and browser ZIP round trips preserve interactor, limits, scoring and interaction samples", async () => {
  const original = validateProblemPackage("guess.zip", zipData());
  const draft = buildEditorDraftFromExtracted(original);
  const files = [buildProblemPackageZip({ ...metadata, draft }), Buffer.from(await (await buildProblemPackageZipBlob({ ...metadata, draft })).arrayBuffer())];
  for (const zip of files) {
    const extracted = validateProblemPackage("export.zip", zip);
    assert.equal(extracted.checkerType, "interactive");
    assert.equal(extracted.checkerSourceCode?.trim(), original.checkerSourceCode?.trim());
    assert.deepEqual(extracted.interactive, original.interactive);
    assert.equal(extracted.scoringType, "sum_of_groups");
    assert.equal(extracted.samples[0].interaction, original.samples[0].interaction);
    const file = Object.assign(Buffer.from(zip), {name:"export.zip",size:zip.length}) as unknown as File;
    const inspected = await inspectProblemPackageClient(file);
    assert.deepEqual(inspected.draft.interactive, original.interactive);
    assert.equal(inspected.draft.checkerSourceCode.trim(), original.checkerSourceCode?.trim());
  }
});

test("large-package lazy path materializes only requested private input and an empty optional answer", async () => {
  const source = await createLazyProblemPackageSourceFromBuffer("guess.zip", zipData());
  const directory = await mkdtemp(path.join(os.tmpdir(), "ojp-interactive-package-"));
  try {
    assert.equal(source.manifest.checkerType, "interactive");
    assert.equal(source.manifest.interactive?.wallTimeLimitMs, 3000);
    assert.match(source.manifest.sampleCases[0].interaction!, /EQUAL/);
    assert.equal((await source.readTestCase("group1","case01")).output, "");
    const files = await source.materializeTestCaseFiles("group1","case01",directory);
    assert.equal(await readFile(files.outputPath,"utf8"), "");
    assert.equal((await readFile(files.inputPath,"utf8")).trim(), "37");
  } finally { await source.cleanup(); await rm(directory,{recursive:true,force:true}); }
});

test("interactive config rejects invalid deadlines, missing interactor and unsafe case pairs", () => {
  assert.throws(()=>parseInteractiveLimits({idleTimeLimitMs:2000,wallTimeLimitMs:1000}));
  assert.throws(()=>parseInteractiveLimits({wallTimeLimitMs:Infinity}));
  const zip=new AdmZip(zipData());zip.deleteFile("interactor/Main.py");
  assert.throws(()=>validateProblemPackage("bad.zip",zip.toBuffer()),/interactor\/Main.py/);
  const orphan=new AdmZip(zipData());orphan.addFile("tests/group1/orphan.out",Buffer.from("x"));
  assert.throws(()=>validateProblemPackage("bad.zip",orphan.toBuffer()),/without .in/);
});

test("public and submitter results never contain private interaction logs; author results retain them", () => {
  assert.equal(canViewPrivateInteraction(undefined,"author"),false);
  assert.equal(canViewPrivateInteraction({id:"student",role:"user"},"author"),false);
  assert.equal(canViewPrivateInteraction({id:"student",role:"problem_author"},"author"),false);
  assert.equal(canViewPrivateInteraction({id:"author",role:"problem_author"},"author"),true);
  assert.equal(canViewPrivateInteraction({id:"admin",role:"admin"},"author"),true);
  const rows=[{id:"r",groupName:"g",testCaseName:"c",verdict:"accepted" as const,timeMs:1,memoryKb:1,message:"Accepted",interactionLog:"secret"}];
  assert.equal(visibleInteractionResults(rows,false)[0].interactionLog,undefined);
  assert.doesNotMatch(JSON.stringify(visibleInteractionResults(rows,false)),/secret/);
  assert.equal(visibleInteractionResults(rows,true)[0].interactionLog,"secret");
  assert.equal(rows[0].interactionLog,"secret");
});

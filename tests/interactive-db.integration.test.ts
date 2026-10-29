import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

test("isolated PostgreSQL: additive log migration preserves legacy rows, is repeatable and logs survive reconnect", {
  skip: !process.env.INTERACTIVE_TEST_DATABASE_URL,
}, async () => {
  const url = new URL(process.env.INTERACTIVE_TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/ojp_interactive_test", "Use an empty disposable local interactive database only.");
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const tables = await db.$queryRawUnsafe<Array<{ count: bigint }>>("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");
    assert.equal(Number(tables[0].count), 0, "Refusing to modify a non-empty test database");
    await db.$executeRawUnsafe('CREATE TYPE "SubmissionStatus" AS ENUM (\'accepted\')');
    await db.$executeRawUnsafe(`CREATE TABLE "SubmissionRuntimeTestResult" (
      "id" TEXT PRIMARY KEY, "submissionId" TEXT NOT NULL, "orderIndex" INTEGER NOT NULL,
      "groupName" TEXT NOT NULL, "testCaseName" TEXT NOT NULL, "verdict" "SubmissionStatus" NOT NULL,
      "timeMs" INTEGER NOT NULL, "memoryKb" INTEGER NOT NULL, "message" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.$executeRawUnsafe(`INSERT INTO "SubmissionRuntimeTestResult"
      ("id","submissionId","orderIndex","groupName","testCaseName","verdict","timeMs","memoryKb","message")
      VALUES ('legacy','old',0,'group1','case01','accepted',17,2048,'Accepted')`);
    const original = await db.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM "SubmissionRuntimeTestResult"');
    const sql = await readFile(new URL("../prisma/interactive-schema.sql", import.meta.url), "utf8");
    await db.$executeRawUnsafe(sql);
    await db.$executeRawUnsafe(sql);
    const preserved = await db.submissionRuntimeTestResult.findUniqueOrThrow({ where: { id: "legacy" } });
    const { interactionLog, ...legacy } = preserved;
    assert.equal(interactionLog, null);
    assert.deepEqual(legacy, original[0]);
    await db.submissionRuntimeTestResult.create({ data: {
      id:"interactive", submissionId:"new", orderIndex:0, groupName:"group1", testCaseName:"case01", verdict:"accepted",
      timeMs:19, memoryKb:4096, message:"Accepted", interactionLog:"private conversation\n",
    } });
    await db.$disconnect();
    const restored = await db.submissionRuntimeTestResult.findUniqueOrThrow({ where: { id: "interactive" } });
    assert.equal(restored.interactionLog, "private conversation\n");
    assert.equal(await db.submissionRuntimeTestResult.count(), 2);
  } finally { await db.$disconnect(); }
});

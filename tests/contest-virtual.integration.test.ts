import assert from "node:assert/strict";
import test from "node:test";

test(
  "isolated PostgreSQL: concurrent virtual starts are idempotent and completion survives restart",
  { skip: !process.env.CONTEST_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.CONTEST_TEST_DATABASE_URL!);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname === "/ojp_contest_test",
      "Use a disposable local contest database only.",
    );
    process.env.DATABASE_URL = url.toString();
    const { prisma } = await import("../lib/db/prisma");
    const store = await import("../lib/contest-virtual-store");
    const id = `db-test-${Date.now()}`;
    try {
      const attempts = await Promise.all(
        Array.from({ length: 12 }, () =>
          store.startVirtualParticipation(id, "student", 3600_000),
        ),
      );
      assert.equal(new Set(attempts.map((a) => a.id)).size, 1);
      assert.equal(new Set(attempts.map((a) => a.startedAt)).size, 1);
      assert.equal(
        Date.parse(attempts[0].endAt) - Date.parse(attempts[0].startedAt),
        3600_000,
      );
      assert.equal(await store.readVirtualParticipation(id, "other"), null);
      const finished = await store.finishVirtualParticipation(id, "student");
      assert.ok(finished?.finishedAt);
      const again = await store.startVirtualParticipation(id, "student", 10);
      assert.deepEqual(again, finished);
      const repeated = await store.finishVirtualParticipation(id, "student");
      assert.equal(repeated!.finishedAt, finished.finishedAt);
      await prisma.$disconnect();
      assert.deepEqual(
        await store.readVirtualParticipation(id, "student"),
        finished,
      );
    } finally {
      await prisma.contestVirtualParticipation.deleteMany({
        where: { contestId: id },
      });
      await prisma.$disconnect();
    }
  },
);

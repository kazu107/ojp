import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadDotenv({ path: ".env.local" });
loadDotenv();

const defaultDatabaseUrl = "postgresql://postgres:postgres@localhost:15432/ojp?schema=public";
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = defaultDatabaseUrl;
}

const LEGACY_TO_NEW_STATUS = [
  ["WJ", "pending"],
  ["AC", "accepted"],
  ["WA", "wrong_answer"],
  ["TLE", "time_limit_exceeded"],
  ["MLE", "memory_limit_exceeded"],
  ["RE", "runtime_error"],
  ["CE", "compilation_error"],
  ["IE", "internal_error"],
];

const ADDITIONAL_STATUS_VALUES = [
  "queued",
  "compiling",
  "running",
  "judging",
  "cancelled",
];

const NEW_STATUS_VALUES = Array.from(
  new Set([
    ...LEGACY_TO_NEW_STATUS.map((entry) => entry[1]),
    ...ADDITIONAL_STATUS_VALUES,
  ]),
);

function escapeSqlLiteral(value) {
  return value.replace(/'/g, "''");
}

async function enumExists(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT to_regtype('\"SubmissionStatus\"') IS NOT NULL AS exists",
  );
  return rows[0]?.exists === true;
}

async function tableExists(prisma, tableName) {
  const escaped = escapeSqlLiteral(`"${tableName}"`);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('${escaped}') IS NOT NULL AS exists`,
  );
  return rows[0]?.exists === true;
}

async function ensureEnumValue(prisma, value) {
  const escaped = escapeSqlLiteral(value);
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'SubmissionStatus'
          AND e.enumlabel = '${escaped}'
      ) THEN
        ALTER TYPE "SubmissionStatus" ADD VALUE '${escaped}';
      END IF;
    END
    $$;
  `);
}

function buildStatusCase(columnName) {
  const caseClauses = LEGACY_TO_NEW_STATUS.map(
    ([legacyValue, newValue]) =>
      `WHEN '${escapeSqlLiteral(legacyValue)}' THEN '${escapeSqlLiteral(newValue)}'::"SubmissionStatus"`,
  ).join("\n      ");
  return `
    CASE ${columnName}::text
      ${caseClauses}
      ELSE ${columnName}
    END
  `;
}

async function migrateLegacyRows(prisma) {
  const submissionExists = await tableExists(prisma, "Submission");
  if (submissionExists) {
    await prisma.$executeRawUnsafe(`
      UPDATE "Submission"
      SET status = ${buildStatusCase("status")}
    `);
  }

  const submissionTestResultExists = await tableExists(prisma, "SubmissionTestResult");
  if (submissionTestResultExists) {
    await prisma.$executeRawUnsafe(`
      UPDATE "SubmissionTestResult"
      SET verdict = ${buildStatusCase("verdict")}
    `);
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const hasEnum = await enumExists(prisma);
    if (!hasEnum) {
      console.log("[db:migrate:legacy-status] SubmissionStatus enum not found. Skipped.");
      return;
    }

    for (const statusValue of NEW_STATUS_VALUES) {
      await ensureEnumValue(prisma, statusValue);
    }

    await migrateLegacyRows(prisma);
    console.log("[db:migrate:legacy-status] Legacy status migration completed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[db:migrate:legacy-status] Migration failed:", error);
  process.exit(1);
});

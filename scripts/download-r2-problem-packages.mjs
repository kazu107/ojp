import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function getR2Endpoint() {
  const explicit = process.env.R2_ENDPOINT?.trim();
  if (explicit) {
    return explicit;
  }
  const accountId = requireEnv("R2_ACCOUNT_ID");
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function getR2Client() {
  return new S3Client({
    region: "auto",
    endpoint: getR2Endpoint(),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

function keyToLocalPath(outputDir, key) {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  return path.join(outputDir, ...normalized.split("/"));
}

async function fileExistsWithSize(filePath, sizeBytes) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size === sizeBytes;
  } catch {
    return false;
  }
}

async function main() {
  const prisma = new PrismaClient();
  const client = getR2Client();
  const outputDir = path.resolve("recovered", "problem-packages");

  try {
    const jobs = await prisma.packageJob.findMany({
      where: {
        status: "completed",
        problemId: { not: null },
      },
      orderBy: {
        updatedAt: "asc",
      },
      select: {
        id: true,
        type: true,
        problemId: true,
        fileName: true,
        storageRef: true,
        updatedAt: true,
      },
    });

    const uniqueRefs = new Map();
    for (const job of jobs) {
      const ref = job.storageRef;
      if (!ref || typeof ref !== "object" || typeof ref.key !== "string") {
        continue;
      }
      if (!uniqueRefs.has(ref.key)) {
        uniqueRefs.set(ref.key, {
          jobId: job.id,
          type: job.type,
          problemId: job.problemId,
          fileName: job.fileName,
          updatedAt: job.updatedAt,
          storageRef: ref,
        });
      }
    }

    await mkdir(outputDir, { recursive: true });

    const manifest = [];
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;

    for (const entry of uniqueRefs.values()) {
      const ref = entry.storageRef;
      const localPath = keyToLocalPath(outputDir, ref.key);
      await mkdir(path.dirname(localPath), { recursive: true });

      if (await fileExistsWithSize(localPath, Number(ref.sizeBytes ?? 0))) {
        skipped += 1;
        manifest.push({
          ...entry,
          localPath,
          action: "skipped",
        });
        continue;
      }

      try {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: ref.bucket ?? requireEnv("R2_BUCKET"),
            Key: ref.key,
          }),
        );

        if (!response.Body) {
          throw new Error(`R2 object body is empty: ${ref.key}`);
        }

        const bytes = await response.Body.transformToByteArray();
        await writeFile(localPath, Buffer.from(bytes));
        downloaded += 1;
        manifest.push({
          ...entry,
          localPath,
          action: "downloaded",
        });
      } catch (error) {
        failed += 1;
        manifest.push({
          ...entry,
          localPath,
          action: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const manifestPath = path.join(outputDir, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          totalJobs: jobs.length,
          uniqueRefs: uniqueRefs.size,
          downloaded,
          skipped,
          failed,
          entries: manifest,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          outputDir,
          manifestPath,
          totalJobs: jobs.length,
          uniqueRefs: uniqueRefs.size,
          downloaded,
          skipped,
          failed,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

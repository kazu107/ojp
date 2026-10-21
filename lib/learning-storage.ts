import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  getR2Client,
  isProblemPackageObjectStorageEnabled,
} from "./problem-package-storage";
import { LearningError } from "./learning";

export async function putLearningMarkdown(
  versionId: string,
  itemId: string,
  markdown: string,
) {
  if (
    process.env.LEARNING_STORAGE === "db" ||
    !isProblemPackageObjectStorageEnabled()
  )
    return null;
  const key = `learning/${versionId}/${itemId}.md`;
  const body = Buffer.from(markdown, "utf8");
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!.trim(),
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );
  return key;
}

export async function getLearningMarkdown(key: string): Promise<string> {
  if (!/^learning\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.md$/.test(key))
    throw new LearningError("Invalid lesson storage key.", 500);
  const response = await getR2Client().send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET!.trim(), Key: key }),
  );
  if (!response.Body || (response.ContentLength ?? 0) > 1024 * 1024)
    throw new LearningError("Invalid lesson object.", 502);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    bytes += chunk.byteLength;
    if (bytes > 1024 * 1024)
      throw new LearningError("Lesson object exceeds 1 MiB.", 502);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function removeLearningMarkdown(keys: string[]) {
  for (const key of keys) {
    try {
      await getR2Client().send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET!.trim(),
          Key: key,
        }),
      );
    } catch {
      console.error("Could not remove an unpublished learning object.");
    }
  }
}

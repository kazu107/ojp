import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

export interface ProblemPackageStorageRef {
  provider: "r2";
  bucket: string;
  key: string;
  uploadedAt: string;
  sizeBytes: number;
  etag: string | null;
}

function getR2Bucket(): string {
  const bucket = process.env.R2_BUCKET?.trim();
  if (!bucket) {
    throw new Error("R2_BUCKET is not configured");
  }
  return bucket;
}

function getR2Endpoint(): string {
  const explicit = process.env.R2_ENDPOINT?.trim();
  if (explicit) {
    return explicit;
  }

  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  if (!accountId) {
    throw new Error("R2_ENDPOINT or R2_ACCOUNT_ID is required");
  }
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function getR2AccessKeyId(): string {
  const value = process.env.R2_ACCESS_KEY_ID?.trim();
  if (!value) {
    throw new Error("R2_ACCESS_KEY_ID is not configured");
  }
  return value;
}

function getR2SecretAccessKey(): string {
  const value = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!value) {
    throw new Error("R2_SECRET_ACCESS_KEY is not configured");
  }
  return value;
}

export function isProblemPackageObjectStorageEnabled(): boolean {
  return Boolean(
    process.env.R2_BUCKET &&
      (process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID) &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

let cachedClient: S3Client | null = null;

function getR2Client(): S3Client {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = new S3Client({
    region: "auto",
    endpoint: getR2Endpoint(),
    credentials: {
      accessKeyId: getR2AccessKeyId(),
      secretAccessKey: getR2SecretAccessKey(),
    },
  });
  return cachedClient;
}

function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase();
  const normalized = trimmed.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) {
    return "problem-package.zip";
  }
  return normalized.endsWith(".zip") ? normalized : `${normalized}.zip`;
}

function buildObjectKey(prefix: string, fileName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}/${stamp}-${sanitizeFileName(fileName)}`;
}

async function putPackageZip(input: {
  keyPrefix: string;
  fileName: string;
  body: Buffer | Uint8Array | Readable;
  sizeBytes: number;
}): Promise<ProblemPackageStorageRef> {
  const bucket = getR2Bucket();
  const key = buildObjectKey(input.keyPrefix, input.fileName);
  const client = getR2Client();
  const response = await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: input.body,
      ContentType: "application/zip",
      ContentLength: input.sizeBytes > 0 ? input.sizeBytes : undefined,
    }),
  );

  return {
    provider: "r2",
    bucket,
    key,
    uploadedAt: new Date().toISOString(),
    sizeBytes: input.sizeBytes,
    etag: response.ETag ?? null,
  };
}

export async function putProblemPackageZip(input: {
  problemId: string;
  fileName: string;
  zipBuffer: Buffer;
}): Promise<ProblemPackageStorageRef> {
  return putPackageZip({
    keyPrefix: `problem-packages/${input.problemId}`,
    fileName: input.fileName,
    body: input.zipBuffer,
    sizeBytes: input.zipBuffer.byteLength,
  });
}

export async function putProblemPackageZipStream(input: {
  keyPrefix: string;
  fileName: string;
  body: Readable;
  sizeBytes: number;
}): Promise<ProblemPackageStorageRef> {
  return putPackageZip({
    keyPrefix: input.keyPrefix,
    fileName: input.fileName,
    body: input.body,
    sizeBytes: input.sizeBytes,
  });
}

export async function getProblemPackageZip(
  ref: ProblemPackageStorageRef,
): Promise<Buffer> {
  const client = getR2Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: ref.bucket,
      Key: ref.key,
    }),
  );

  if (!response.Body) {
    throw new Error(`R2 object body is empty: ${ref.key}`);
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function getProblemPackageZipStream(
  ref: ProblemPackageStorageRef,
): Promise<ReadableStream<Uint8Array>> {
  const client = getR2Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: ref.bucket,
      Key: ref.key,
    }),
  );

  if (!response.Body) {
    throw new Error(`R2 object body is empty: ${ref.key}`);
  }

  if (typeof response.Body.transformToWebStream === "function") {
    return response.Body.transformToWebStream();
  }

  return Readable.toWeb(response.Body as Readable) as ReadableStream<Uint8Array>;
}

export async function deleteProblemPackageZip(
  ref: ProblemPackageStorageRef,
): Promise<void> {
  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: ref.bucket,
      Key: ref.key,
    }),
  );
}

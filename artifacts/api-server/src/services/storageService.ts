import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { Response as ExpressResponse } from "express";
import { Readable } from "stream";
import config from "../config.js";

function getR2Config() {
  const { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl } = config.r2;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      "Missing Cloudflare R2 configuration. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME environment variables."
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const { accountId, accessKeyId, secretAccessKey } = getR2Config();
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 4,
  });
  return cachedClient;
}

function getBucket(): string {
  return getR2Config().bucketName;
}

/** Upload a Buffer to R2 at the given object path. */
export async function uploadBuffer(
  objectPath: string,
  buffer: Buffer,
  contentType = "image/png"
): Promise<void> {
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: objectPath,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

/** Delete a file from R2 (ignores "not found" errors). */
export async function deleteObject(objectPath: string): Promise<void> {
  try {
    const client = getClient();
    await client.send(
      new DeleteObjectCommand({ Bucket: getBucket(), Key: objectPath })
    );
  } catch {
    // ignore not-found
  }
}

/** Check whether a file exists in R2. */
export async function objectExists(objectPath: string): Promise<boolean> {
  try {
    const client = getClient();
    await client.send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: objectPath })
    );
    return true;
  } catch {
    return false;
  }
}

/** Download an R2 object directly into a Buffer. Returns null if not found. */
export async function downloadBuffer(objectPath: string): Promise<Buffer | null> {
  try {
    const client = getClient();
    const result = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: objectPath })
    );
    if (!result.Body) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err: unknown) {
    const code = (err as { Code?: string; name?: string }).Code ?? (err as { name?: string }).name;
    if (code === "NoSuchKey" || code === "NotFound") return null;
    throw err;
  }
}

/** Stream an R2 file as an HTTP response. Returns false if not found. */
export async function streamObject(
  objectPath: string,
  res: ExpressResponse
): Promise<boolean> {
  try {
    const client = getClient();
    const result = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: objectPath })
    );

    if (!result.Body) return false;

    const contentType = result.ContentType ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    if (result.ContentLength) {
      res.setHeader("Content-Length", result.ContentLength);
    }

    await new Promise<void>((resolve, reject) => {
      (result.Body as Readable)
        .on("error", reject)
        .pipe(res)
        .on("finish", resolve)
        .on("error", reject);
    });

    return true;
  } catch (err: unknown) {
    const code = (err as { Code?: string; name?: string }).Code ?? (err as { name?: string }).name;
    if (code === "NoSuchKey" || code === "NotFound") return false;
    throw err;
  }
}

/**
 * Return a public URL for a stored object.
 * Falls back to proxying through the API if no public URL is configured.
 */
export function getPublicUrl(objectPath: string): string {
  const { publicUrl } = getR2Config();
  if (publicUrl) {
    return `${publicUrl.replace(/\/$/, "")}/${objectPath}`;
  }
  return `/api/storage/${encodeURIComponent(objectPath)}`;
}

/** Health-check: verify R2 is reachable. */
export async function checkStorageHealth(): Promise<{
  ok: boolean;
  provider: string;
  bucket: string;
  error?: string;
}> {
  let bucketName = "(not configured)";
  try {
    const config = getR2Config();
    bucketName = config.bucketName;
    await objectExists("__health_check__");
    return { ok: true, provider: "Cloudflare R2", bucket: bucketName };
  } catch (err) {
    return {
      ok: false,
      provider: "Cloudflare R2",
      bucket: bucketName,
      error: String(err),
    };
  }
}

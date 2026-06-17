import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { Response as ExpressResponse } from "express";
import { Readable } from "stream";
import config from "../config.js";

const PROVIDER = "Cloudflare R2";

function requireR2Config(): {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
} {
  const { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl } =
    config.r2;
  const missing: string[] = [];
  if (!accountId) missing.push("R2_ACCOUNT_ID");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucketName) missing.push("R2_BUCKET_NAME");
  if (missing.length > 0) {
    throw new Error(
      `Missing Cloudflare R2 configuration: ${missing.join(", ")}. ` +
        `Set these variables in your hosting provider before starting the server.`,
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const { accountId, accessKeyId, secretAccessKey } = requireR2Config();
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

function getBucket(): string {
  return requireR2Config().bucketName;
}

function isNotFoundError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

/** Upload a Buffer to R2 at the given object path. */
export async function uploadBuffer(
  objectPath: string,
  buffer: Buffer,
  contentType = "image/png",
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: objectPath,
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

/** Delete a file from R2 (ignores "not found" errors). */
export async function deleteObject(objectPath: string): Promise<void> {
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: getBucket(), Key: objectPath }),
    );
  } catch (err) {
    if (isNotFoundError(err)) return;
    // swallow other errors to match previous behavior
  }
}

/** Check whether a file exists in R2. */
export async function objectExists(objectPath: string): Promise<boolean> {
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: objectPath }),
    );
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    return false;
  }
}

/** Download an object directly into a Buffer. Returns null if not found. */
export async function downloadBuffer(
  objectPath: string,
): Promise<Buffer | null> {
  try {
    const result = await getClient().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: objectPath }),
    );
    if (!result.Body) return null;
    const stream = result.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/** Stream a stored file as an HTTP response. Returns false if not found. */
export async function streamObject(
  objectPath: string,
  res: ExpressResponse,
): Promise<boolean> {
  try {
    const result = await getClient().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: objectPath }),
    );
    if (!result.Body) return false;

    const contentType = result.ContentType ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (typeof result.ContentLength === "number") {
      res.setHeader("Content-Length", String(result.ContentLength));
    }

    const stream = result.Body as Readable;
    await new Promise<void>((resolve, reject) => {
      stream
        .on("error", reject)
        .pipe(res)
        .on("finish", resolve)
        .on("error", reject);
    });

    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

/**
 * Return a URL the browser can load to fetch a stored object.
 * If R2_PUBLIC_URL is configured (e.g. a custom domain or r2.dev URL),
 * use it directly. Otherwise proxy through the API.
 */
export function getPublicUrl(objectPath: string): string {
  const publicBase = config.r2.publicUrl;
  const encodedPath = objectPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  if (publicBase) {
    return `${publicBase.replace(/\/+$/, "")}/${encodedPath}`;
  }
  return `/api/storage/${encodedPath}`;
}

/** Health-check: verify R2 is reachable. */
export async function checkStorageHealth(): Promise<{
  ok: boolean;
  provider: string;
  bucket: string;
  error?: string;
}> {
  let bucket = "(not configured)";
  try {
    bucket = getBucket();
    await objectExists("__health_check__");
    return { ok: true, provider: PROVIDER, bucket };
  } catch (err) {
    return {
      ok: false,
      provider: PROVIDER,
      bucket,
      error: String(err),
    };
  }
}

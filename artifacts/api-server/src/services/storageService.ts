import { Storage } from "@google-cloud/storage";
import type { Response as ExpressResponse } from "express";
import { Readable } from "stream";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function getBucketId(): string {
  const id = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!id) {
    throw new Error(
      "Missing DEFAULT_OBJECT_STORAGE_BUCKET_ID. Provision an Object Storage bucket via the Replit App Storage tool.",
    );
  }
  return id;
}

let cachedClient: Storage | null = null;

function getClient(): Storage {
  if (cachedClient) return cachedClient;
  cachedClient = new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: {
          type: "json",
          subject_token_field_name: "access_token",
        },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
  return cachedClient;
}

function getFile(objectPath: string) {
  return getClient().bucket(getBucketId()).file(objectPath);
}

/** Upload a Buffer to Object Storage at the given object path. */
export async function uploadBuffer(
  objectPath: string,
  buffer: Buffer,
  contentType = "image/png",
): Promise<void> {
  const file = getFile(objectPath);
  await file.save(buffer, {
    contentType,
    resumable: false,
  });
}

/** Delete a file from Object Storage (ignores "not found" errors). */
export async function deleteObject(objectPath: string): Promise<void> {
  try {
    await getFile(objectPath).delete({ ignoreNotFound: true });
  } catch {
    // ignore
  }
}

/** Check whether a file exists in Object Storage. */
export async function objectExists(objectPath: string): Promise<boolean> {
  try {
    const [exists] = await getFile(objectPath).exists();
    return exists;
  } catch {
    return false;
  }
}

/** Download an object directly into a Buffer. Returns null if not found. */
export async function downloadBuffer(
  objectPath: string,
): Promise<Buffer | null> {
  try {
    const [exists] = await getFile(objectPath).exists();
    if (!exists) return null;
    const [buf] = await getFile(objectPath).download();
    return buf;
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 404) return null;
    throw err;
  }
}

/** Stream a stored file as an HTTP response. Returns false if not found. */
export async function streamObject(
  objectPath: string,
  res: ExpressResponse,
): Promise<boolean> {
  const file = getFile(objectPath);
  try {
    const [exists] = await file.exists();
    if (!exists) return false;

    const [metadata] = await file.getMetadata();
    const contentType =
      (metadata.contentType as string | undefined) ?? "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (metadata.size !== undefined && metadata.size !== null) {
      res.setHeader("Content-Length", String(metadata.size));
    }

    const stream = file.createReadStream();
    await new Promise<void>((resolve, reject) => {
      (stream as Readable)
        .on("error", reject)
        .pipe(res)
        .on("finish", resolve)
        .on("error", reject);
    });

    return true;
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 404) return false;
    throw err;
  }
}

/**
 * Return a URL the browser can load to fetch a stored object.
 * Always proxies through the API so we don't need a public bucket URL.
 */
export function getPublicUrl(objectPath: string): string {
  return `/api/storage/${objectPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** Health-check: verify Object Storage is reachable. */
export async function checkStorageHealth(): Promise<{
  ok: boolean;
  provider: string;
  bucket: string;
  error?: string;
}> {
  let bucket = "(not configured)";
  try {
    bucket = getBucketId();
    await objectExists("__health_check__");
    return { ok: true, provider: "Replit Object Storage", bucket };
  } catch (err) {
    return {
      ok: false,
      provider: "Replit Object Storage",
      bucket,
      error: String(err),
    };
  }
}

import { Storage } from "@google-cloud/storage";
import type { Response as ExpressResponse, Request as ExpressRequest } from "express";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const gcs = new Storage({
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
  } as Parameters<typeof Storage>[0]["credentials"],
  projectId: "",
});

function getBucketId(): string {
  const id = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!id) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");
  return id;
}

/** Upload a Buffer to GCS at the given object path. */
export async function uploadBuffer(
  objectPath: string,
  buffer: Buffer,
  contentType = "image/png",
): Promise<void> {
  const bucket = gcs.bucket(getBucketId());
  const file = bucket.file(objectPath);
  await file.save(buffer, { contentType, resumable: false });
}

/** Delete a file from GCS (ignores "not found" errors). */
export async function deleteObject(objectPath: string): Promise<void> {
  try {
    const bucket = gcs.bucket(getBucketId());
    await bucket.file(objectPath).delete();
  } catch {
    // ignore not-found
  }
}

/** Check whether a file exists in GCS. */
export async function objectExists(objectPath: string): Promise<boolean> {
  const bucket = gcs.bucket(getBucketId());
  const [exists] = await bucket.file(objectPath).exists();
  return exists;
}

/** Stream a GCS file as an HTTP response. Returns false if not found. */
export async function streamObject(
  objectPath: string,
  res: ExpressResponse,
): Promise<boolean> {
  const bucket = gcs.bucket(getBucketId());
  const file = bucket.file(objectPath);

  const [exists] = await file.exists();
  if (!exists) return false;

  const [meta] = await file.getMetadata();
  const contentType = (meta.contentType as string | undefined) ?? "application/octet-stream";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

  await new Promise<void>((resolve, reject) => {
    file.createReadStream()
      .on("error", reject)
      .pipe(res)
      .on("finish", resolve)
      .on("error", reject);
  });

  return true;
}

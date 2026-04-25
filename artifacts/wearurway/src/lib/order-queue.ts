/**
 * Durable, server-owned order pipeline (client side).
 *
 * Contract with the server:
 *   When `/api/create-order` returns HTTP 200 with an orderId, the order is
 *   FULLY accepted. The server is from that point solo-responsible for:
 *     - rendering the design PNGs from the small spec we sent,
 *     - uploading them and the payment proof to object storage,
 *     - sending the Telegram notification to the admin.
 *   The client may close, the phone may die, the network may drop — none of
 *   that affects the order anymore.
 *
 * What the client does before posting:
 *   The design layers live as `blob:` URLs (pure browser memory). Before we
 *   call /create-order we walk the design spec and upload every blob: layer
 *   to /api/shared-layers, replacing each URL with its server-hosted twin.
 *   The POSTed body therefore contains only small JSON: customer info,
 *   payment proof, and a designJob whose imageUrls are all server-resolvable.
 *
 * Durability before HTTP 200:
 *   A `spec` record is saved to IndexedDB before any uploading starts so a
 *   tab kill mid-flight can be retried by Background Sync / next-visit
 *   flush. The server treats the client-supplied orderId as an idempotency
 *   key, so re-posting the same order is safe.
 */

import type { CreateOrderDesignJob, CreateOrderDesignLayer } from "@workspace/api-client-react";

const DB_NAME = "wearurway-order-queue";
const DB_VERSION = 1;
const STORE = "pending-orders";
const SW_PATH = "/order-sync-sw.js";
const SYNC_TAG = "wearurway-order-sync";

export interface QueuedOrderFile {
  fileName: string;
  dataUrl: string;
}

/** Customer + product info shared between every record. */
export interface QueuedOrderCustomer {
  name: string;
  phone: string;
  address: string;
  product?: string;
  fit?: string;
  color: string;
  size: { name: string; realWidth?: number; realHeight?: number };
  paymentMethod: "cod" | "instapay";
  productPrice: number;
  shippingPrice: number;
  total: number;
  frontImage?: string;
  backImage?: string;
}

/** The full payload that gets POSTed to /api/create-order. */
export interface QueuedOrderPayload extends QueuedOrderCustomer {
  orderId: string;
  paymentProof?: QueuedOrderFile;
  designJob?: CreateOrderDesignJob;
  feedback?: string;
}

/**
 * The only record kind the queue uses now. Holds everything the client needs
 * to (re)render and (re)post the order. Designed to be cheap to write — there
 * are no rendered PNGs in here, only the small design spec.
 */
export interface QueuedOrderSpecRecord {
  id: string;
  kind: "spec";
  orderId: string;
  customer: QueuedOrderCustomer;
  paymentProof?: QueuedOrderFile;
  designJob?: CreateOrderDesignJob;
  feedback?: string;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Kept for IndexedDB backward compatibility — older clients may have records
 * of this shape sitting in their queue. The new code drops them on boot
 * (see `flushQueuedOrders`) so they don't replay forever.
 */
export interface QueuedOrderSubmitRecord {
  id: string;
  kind: "submit";
  payload: QueuedOrderPayload;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export type QueuedOrderRecord = QueuedOrderSpecRecord | QueuedOrderSubmitRecord;

function makeQueueId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

/**
 * Generate a customer-facing order id on the client. Long enough that
 * collisions are negligible across the lifetime of the brand, while still
 * looking friendly (e.g. WW-A4F2K8B1).
 */
export function generateOrderId(): string {
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WW-${part()}${part()}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T | undefined;
    Promise.resolve(fn(store))
      .then((value) => {
        result = value;
      })
      .catch((err) => {
        tx.abort();
        reject(err);
      });
    tx.oncomplete = () => {
      db.close();
      resolve(result as T);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB transaction error"));
    };
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export interface SaveSpecArgs {
  customer: QueuedOrderCustomer;
  paymentProof?: QueuedOrderFile;
  designJob?: CreateOrderDesignJob;
  feedback?: string;
}

/**
 * Persist a spec record to IndexedDB. Cheap (no rendered PNGs in here) so
 * it's safe to do on the click handler before rendering starts.
 */
export async function saveSpecQueuedOrder(
  args: SaveSpecArgs,
): Promise<{ queueId: string; orderId: string }> {
  const queueId = makeQueueId();
  const orderId = generateOrderId();
  const now = new Date().toISOString();
  const record: QueuedOrderSpecRecord = {
    id: queueId,
    kind: "spec",
    orderId,
    customer: args.customer,
    paymentProof: args.paymentProof,
    designJob: args.designJob,
    feedback: args.feedback,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  await withStore("readwrite", (store) => reqToPromise(store.put(record)));
  return { queueId, orderId };
}

export async function loadQueuedOrders(): Promise<QueuedOrderRecord[]> {
  return withStore("readonly", async (store) => {
    const records = await reqToPromise(store.getAll());
    return (records as QueuedOrderRecord[]).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  });
}

export async function removeQueuedOrder(id: string): Promise<void> {
  await withStore("readwrite", (store) => reqToPromise(store.delete(id)));
}

async function bumpAttempt(id: string, error: string): Promise<void> {
  await withStore("readwrite", async (store) => {
    const existing = (await reqToPromise(store.get(id))) as
      | QueuedOrderRecord
      | undefined;
    if (!existing) return;
    existing.attempts += 1;
    existing.lastError = error;
    existing.updatedAt = new Date().toISOString();
    await reqToPromise(store.put(existing));
  });
}

interface SubmitResult {
  ok: boolean;
  error?: string;
  retriable: boolean;
}

/** True for any URL the server cannot fetch on its own (browser-only blobs). */
function needsServerHosting(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith("blob:");
}

/**
 * Upload a single browser-only blob URL to /api/shared-layers and return the
 * server-hosted URL. The endpoint stores the bytes in R2 and returns a path
 * the server can fetch directly during render.
 */
async function uploadLayerBlob(blobUrl: string): Promise<string> {
  const blobRes = await fetch(blobUrl);
  if (!blobRes.ok) {
    throw new Error(`Could not read layer blob (HTTP ${blobRes.status})`);
  }
  const blob = await blobRes.blob();
  const form = new FormData();
  form.append("file", blob, "layer.png");
  const res = await fetch("/api/shared-layers", { method: "POST", body: form });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(`Layer upload failed: ${msg}`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data?.url) throw new Error("Layer upload returned no URL");
  return data.url;
}

/**
 * Walk a design job, replacing every blob: layer URL with a server-hosted
 * one. Same-blob URLs are coalesced so we don't upload the same bytes twice.
 * Mockup images (front/back) are already server-hosted (/api/uploads/mockups)
 * so we leave them alone.
 */
async function hydrateDesignJob(
  job: CreateOrderDesignJob,
): Promise<CreateOrderDesignJob> {
  const cache = new Map<string, Promise<string>>();
  const resolve = async (layer: CreateOrderDesignLayer): Promise<CreateOrderDesignLayer> => {
    if (!needsServerHosting(layer.imageUrl)) return layer;
    const cached = cache.get(layer.imageUrl);
    const uploadPromise = cached ?? uploadLayerBlob(layer.imageUrl);
    if (!cached) cache.set(layer.imageUrl, uploadPromise);
    const url = await uploadPromise;
    return { ...layer, imageUrl: url };
  };

  const [frontLayers, backLayers] = await Promise.all([
    Promise.all(job.frontLayers.map(resolve)),
    Promise.all(job.backLayers.map(resolve)),
  ]);

  return { ...job, frontLayers, backLayers };
}

/**
 * Hand the entire order off to the server in a single tiny POST. Once the
 * server returns 200 it owns the rest: render → upload → notify. The client
 * has zero further work, so we drop the local spec.
 */
async function uploadLayersAndSubmit(record: QueuedOrderSpecRecord): Promise<SubmitResult> {
  let designJob: CreateOrderDesignJob | undefined;
  if (record.designJob) {
    try {
      designJob = await hydrateDesignJob(record.designJob);
    } catch (err) {
      // Layer uploads can fail for transient reasons (network drop, server
      // hiccup) — keep retrying.
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        retriable: true,
      };
    }
  }

  const payload: QueuedOrderPayload = {
    orderId: record.orderId,
    ...record.customer,
    paymentProof: record.paymentProof,
    designJob,
    feedback: record.feedback,
  };

  return doFetch("/api/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function doFetch(input: RequestInfo, init: RequestInit): Promise<SubmitResult> {
  try {
    const res = await fetch(input, init);
    if (res.ok) return { ok: true, retriable: false };
    if (res.status >= 500) {
      return { ok: false, error: `Server ${res.status}`, retriable: true };
    }
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    return { ok: false, error: message, retriable: false };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      retriable: true,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const processInFlight = new Set<string>();

/**
 * Background worker for spec records that the foreground attempt couldn't
 * deliver (offline, server 5xx, etc.). Just keeps calling uploadLayersAndSubmit
 * with exponential backoff until it sticks. Idempotent because the orderId
 * is fixed on the record.
 */
async function processSpecRecord(record: QueuedOrderSpecRecord): Promise<void> {
  if (processInFlight.has(record.id)) return;
  processInFlight.add(record.id);
  try {
    // Reload the latest copy so attempts/lastError stay accurate across runs.
    const fresh = await getRecord(record.id);
    const current = fresh && fresh.kind === "spec" ? fresh : record;

    while (true) {
      const result = await uploadLayersAndSubmit(current);
      if (result.ok) {
        await removeQueuedOrder(current.id).catch(() => {});
        return;
      }
      await bumpAttempt(current.id, result.error ?? "Unknown error").catch(() => {});
      current.attempts += 1;
      if (!result.retriable) {
        // 4xx from the server — payload is structurally bad and retrying
        // won't help. Drop the record so we don't loop forever.
        // eslint-disable-next-line no-console
        console.error(
          "[order-queue] Order dropped non-retriably:",
          current.orderId,
          result.error,
        );
        await removeQueuedOrder(current.id).catch(() => {});
        return;
      }
      void registerBackgroundSync();
      await delay(backoff(current.attempts));
    }
  } finally {
    processInFlight.delete(record.id);
  }
}

async function getRecord(id: string): Promise<QueuedOrderRecord | undefined> {
  return withStore("readonly", async (store) =>
    (await reqToPromise(store.get(id))) as QueuedOrderRecord | undefined,
  );
}

function backoff(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempt, 8));
}

/**
 * Foreground submission. Saves the spec for durability, renders the design
 * exports, and POSTs the full payload to `/api/create-order`. Resolves only
 * after the server returns 200, by which point the order is guaranteed
 * (uploads + Telegram are now the server's responsibility, not the client's).
 *
 * On a retriable failure (network down, 5xx) the spec stays in IndexedDB and
 * the background worker / Service Worker Background Sync keep retrying — the
 * customer is told their order is saved and will go through automatically.
 */
export async function submitOrderAndWait(
  args: SaveSpecArgs,
): Promise<{ orderId: string }> {
  const { orderId } = await saveSpecQueuedOrder(args);

  const records = await loadQueuedOrders();
  const record = records.find(
    (r): r is QueuedOrderSpecRecord =>
      r.kind === "spec" && r.orderId === orderId,
  );
  if (!record) {
    throw new Error("Order was saved but could not be located for submission");
  }

  const result = await uploadLayersAndSubmit(record);

  if (result.ok) {
    // Server has the full payload (customer + payment proof + rendered design
    // files) in its outbox. We can drop the local record — the order is now
    // entirely the server's responsibility.
    await removeQueuedOrder(record.id).catch(() => {});
    return { orderId };
  }

  await bumpAttempt(record.id, result.error ?? "Unknown error").catch(() => {});

  if (result.retriable) {
    void registerBackgroundSync();
    void processSpecRecord(record);
    throw new Error(
      "We couldn't reach the server. Your order is saved on this device and will be sent automatically as soon as you're online — or you can tap Complete Order again now.",
    );
  }

  // Non-retriable (4xx). Drop the record so we don't loop.
  await removeQueuedOrder(record.id).catch(() => {});
  throw new Error(result.error ?? "Could not place order");
}

/**
 * Drain the queue: re-attempt every pending order. Returns immediately —
 * work continues in the background. Safe to call multiple times concurrently.
 * Called on app boot, on `online`, and from the Service Worker via
 * Background Sync.
 */
export async function flushQueuedOrders(): Promise<void> {
  let records: QueuedOrderRecord[];
  try {
    records = await loadQueuedOrders();
  } catch {
    return;
  }
  for (const record of records) {
    if (record.kind === "spec") {
      void processSpecRecord(record).catch(() => {});
    } else {
      // Legacy record from a previous version of the queue. Drop it so the
      // queue doesn't loop forever on a payload shape we no longer process.
      void removeQueuedOrder(record.id).catch(() => {});
      // eslint-disable-next-line no-console
      console.warn("[order-queue] Dropping legacy submit record:", record.id);
    }
  }
}

export async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    if (reg.sync && typeof reg.sync.register === "function") {
      await reg.sync.register(SYNC_TAG);
    }
  } catch {
    // Background sync not supported or registration failed — in-page retry
    // and the next-visit flush will still handle the order.
  }
}

export async function registerOrderServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register(SW_PATH);
  } catch {
    // SW unsupported (e.g. private browsing) — page-level retry is still active.
  }
}

/**
 * Durable, two-phase client-side order queue.
 *
 * The customer should see the success screen the *instant* they tap Complete
 * Order. Heavy work (image rendering, network upload, server processing) must
 * happen invisibly in the background and survive the page closing, the browser
 * closing, and the device going offline.
 *
 * To make that work the queue stores records in two "kinds":
 *
 *   1. `kind: "spec"` — the small, instantly-savable record:
 *        order id (generated client-side so we can show it immediately),
 *        customer + product info, payment proof data URL, design job spec,
 *        feedback. Saving this to IndexedDB takes ~tens of milliseconds even
 *        on slow phones because there are no rendered PNGs in it yet.
 *
 *   2. `kind: "submit"` — the fully-prepared payload, including the rendered
 *        export PNGs as data URLs, ready to POST to /api/create-order.
 *
 * The flow:
 *   - `saveSpecQueuedOrder` writes the spec record and returns the order id.
 *     The checkout page then immediately shows the success screen.
 *   - `flushQueuedOrders` (called on app boot, on `online`, and right after
 *     the spec is saved) walks the queue:
 *       • for each `spec` record  → render the design exports, upgrade the
 *         record to `submit` kind in IndexedDB, then…
 *       • for each `submit` record → POST it to the server, retrying with
 *         exponential backoff forever, and only delete the record once the
 *         server returns 200.
 *   - The Service Worker (`/order-sync-sw.js`) drains `submit` records when
 *     the OS fires a Background Sync, so retries continue with no tab open.
 *     The SW cannot render images, so any `spec` record waits for the next
 *     time a tab opens.
 *
 * The server treats the client-supplied order id as an idempotency key: if it
 * already has an order with that id it returns 200 immediately, so a POST that
 * reaches the server but whose response is lost will not create a duplicate.
 */

import { generateDesignExportBlobs, type DesignExportBlob } from "./design-export";
import type { CreateOrderDesignJob } from "@workspace/api-client-react";

const DB_NAME = "wearurway-order-queue";
const DB_VERSION = 1;
const STORE = "pending-orders";
const SW_PATH = "/order-sync-sw.js";
const SYNC_TAG = "wearurway-order-sync";

export interface QueuedOrderFile {
  fileName: string;
  dataUrl: string;
}

/** Customer + product info shared between the spec and submit records. */
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
  exportFiles?: QueuedOrderFile[];
  feedback?: string;
}

export interface QueuedOrderSpecRecord {
  id: string;
  kind: "spec";
  orderId: string;
  customer: QueuedOrderCustomer;
  paymentProof?: QueuedOrderFile;
  designJob?: CreateOrderDesignJob;
  feedback?: string;
  /** /api/create-order returned 200 — the order exists on the server. */
  serverAcknowledged?: boolean;
  /** All rendered design files have been uploaded to the server. */
  documentsUploaded?: boolean;
  /** /api/orders/:orderId/complete returned 200 — Telegram notification queued. */
  completed?: boolean;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

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
 * Persist a spec record to IndexedDB. This is the only step the user actually
 * waits for after tapping Complete Order — once it resolves the order is
 * durable and the success screen can be shown.
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

async function patchSpecRecord(
  id: string,
  patch: Partial<QueuedOrderSpecRecord>,
): Promise<void> {
  await withStore("readwrite", async (store) => {
    const existing = (await reqToPromise(store.get(id))) as
      | QueuedOrderRecord
      | undefined;
    if (!existing || existing.kind !== "spec") return;
    Object.assign(existing, patch);
    existing.updatedAt = new Date().toISOString();
    await reqToPromise(store.put(existing));
  });
}

interface SubmitResult {
  ok: boolean;
  error?: string;
  retriable: boolean;
}

interface CreateOrderRequestBody extends QueuedOrderCustomer {
  orderId: string;
  paymentProof?: QueuedOrderFile;
  feedback?: string;
  /** Tells the server to wait for the per-file uploads + /complete call. */
  documentsPending: boolean;
}

/**
 * The lightweight foreground call: customer info + payment proof screenshot.
 * NO rendered design files — those are uploaded later in the background.
 */
async function postCreateOrder(
  record: QueuedOrderSpecRecord,
): Promise<SubmitResult> {
  const body: CreateOrderRequestBody = {
    orderId: record.orderId,
    ...record.customer,
    paymentProof: record.paymentProof,
    feedback: record.feedback,
    documentsPending: !!record.designJob,
  };
  return doFetch("/api/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Raw upload of one rendered design file. */
async function uploadDesignFile(
  orderId: string,
  blob: DesignExportBlob,
): Promise<SubmitResult> {
  const url = `/api/orders/${encodeURIComponent(orderId)}/documents/upload?fileName=${encodeURIComponent(blob.fileName)}`;
  return doFetch(url, {
    method: "POST",
    headers: { "Content-Type": blob.contentType },
    body: blob.blob,
  });
}

/** Tell the server every file is uploaded — triggers the Telegram notification. */
async function postCompleteOrder(
  orderId: string,
  feedback: string | undefined,
): Promise<SubmitResult> {
  return doFetch(`/api/orders/${encodeURIComponent(orderId)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(feedback ? { feedback } : {}),
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
 * Background worker: takes a spec record that is already known to the server
 * (or needs one more /create-order retry) and walks it through the remaining
 * phases — render exports → upload each → /complete → delete. Idempotent and
 * resumable: every phase is gated by a flag on the record so a tab close
 * mid-flight resumes from the right step on the next visit.
 */
async function processSpecRecord(record: QueuedOrderSpecRecord): Promise<void> {
  if (processInFlight.has(record.id)) return;
  processInFlight.add(record.id);
  try {
    // Phase 1: make sure the server has the order (with retry). Idempotent
    // because we always supply the same client-generated orderId.
    while (!record.serverAcknowledged) {
      const result = await postCreateOrder(record);
      if (result.ok) {
        await patchSpecRecord(record.id, { serverAcknowledged: true }).catch(() => {});
        record.serverAcknowledged = true;
        break;
      }
      await bumpAttempt(record.id, result.error ?? "Unknown error").catch(() => {});
      if (!result.retriable) {
        await removeQueuedOrder(record.id).catch(() => {});
        return;
      }
      void registerBackgroundSync();
      await delay(backoff(record.attempts));
    }

    // Phase 2: render and upload the design files (if any). Skip if a
    // previous run already finished this phase.
    if (record.designJob && !record.documentsUploaded) {
      let blobs: DesignExportBlob[] | null = null;
      while (!blobs) {
        try {
          blobs = await generateDesignExportBlobs(record.designJob);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await bumpAttempt(record.id, `render: ${message}`).catch(() => {});
          await delay(backoff(record.attempts));
        }
      }
      for (const blob of blobs) {
        while (true) {
          const result = await uploadDesignFile(record.orderId, blob);
          if (result.ok) break;
          await bumpAttempt(
            record.id,
            `upload ${blob.fileName}: ${result.error ?? "Unknown error"}`,
          ).catch(() => {});
          if (!result.retriable) {
            // 4xx for one file shouldn't block the rest of the order; log and skip.
            // eslint-disable-next-line no-console
            console.error(
              "[order-queue] Dropping file after non-retriable error:",
              record.orderId,
              blob.fileName,
              result.error,
            );
            break;
          }
          void registerBackgroundSync();
          await delay(backoff(record.attempts));
        }
      }
      await patchSpecRecord(record.id, { documentsUploaded: true }).catch(() => {});
      record.documentsUploaded = true;
    }

    // Phase 3: signal completion so the server queues the Telegram notification.
    while (!record.completed) {
      const result = await postCompleteOrder(record.orderId, record.feedback);
      if (result.ok) {
        record.completed = true;
        break;
      }
      await bumpAttempt(record.id, result.error ?? "Unknown error").catch(() => {});
      if (!result.retriable) {
        // The order exists; if /complete is rejected non-retriably we still
        // drop the record because retries won't help.
        break;
      }
      void registerBackgroundSync();
      await delay(backoff(record.attempts));
    }

    // All done — remove the local record.
    await removeQueuedOrder(record.id).catch(() => {});
  } finally {
    processInFlight.delete(record.id);
  }
}

function backoff(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempt, 8));
}

/**
 * Foreground submission. The customer waits ONLY for `/api/create-order` to
 * return 200 — a tiny payload (customer info + payment proof screenshot, no
 * rendered design files). The moment the server confirms, the success screen
 * is shown and this resolves.
 *
 * Everything heavy — rendering the high-res design PNGs, uploading them to
 * object storage, and sending the Telegram notification — is then handed off
 * to a background worker. That worker resumes after a tab close / reload
 * because every step is checkpointed in IndexedDB.
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

  // Foreground call — small body, fast.
  const result = await postCreateOrder(record);

  if (!result.ok) {
    await bumpAttempt(record.id, result.error ?? "Unknown error").catch(() => {});
    if (result.retriable) {
      // Kick off background retries so the order still goes through whenever
      // the network comes back.
      void registerBackgroundSync();
      void processSpecRecord(record);
      throw new Error(
        "We couldn't reach the server. Your order is saved on this device and will be sent automatically as soon as you're online — or you can tap Complete Order again now.",
      );
    }
    // Non-retriable (4xx) — payload is structurally bad. Drop the record so
    // the queue doesn't loop forever.
    await removeQueuedOrder(record.id).catch(() => {});
    throw new Error(result.error ?? "Could not place order");
  }

  // Server has the order. Mark it on the spec record so the background worker
  // skips the create step, then kick the worker off WITHOUT awaiting it. The
  // popup closes and the success screen renders immediately.
  await patchSpecRecord(record.id, { serverAcknowledged: true }).catch(() => {});
  record.serverAcknowledged = true;
  void processSpecRecord(record);

  return { orderId };
}

/**
 * Drain the queue: continue any in-progress order through its remaining
 * phases (create → render → upload → complete → delete). Returns
 * immediately — work continues in the background. Safe to call multiple
 * times concurrently. Called on app boot, on `online`, and from the Service
 * Worker via Background Sync.
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
      // Legacy heavy-payload record from a previous version of the queue.
      // Drop it — the user has already seen success or will retry, and we no
      // longer use this code path.
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

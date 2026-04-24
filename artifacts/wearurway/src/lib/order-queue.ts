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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read blob"));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read blob"));
    reader.readAsDataURL(blob);
  });
}

async function exportBlobsToFiles(
  blobs: DesignExportBlob[],
): Promise<QueuedOrderFile[]> {
  const out: QueuedOrderFile[] = [];
  for (const file of blobs) {
    const dataUrl = await blobToDataUrl(file.blob);
    out.push({ fileName: file.fileName, dataUrl });
  }
  return out;
}

interface SubmitResult {
  ok: boolean;
  error?: string;
  retriable: boolean;
}

async function postOrder(payload: QueuedOrderPayload): Promise<SubmitResult> {
  try {
    const res = await fetch("/api/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
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

const renderInFlight = new Set<string>();
const submitInFlight = new Set<string>();

async function upgradeSpecToSubmit(
  record: QueuedOrderSpecRecord,
): Promise<QueuedOrderSubmitRecord> {
  let exportFiles: QueuedOrderFile[] = [];
  if (record.designJob) {
    const blobs = await generateDesignExportBlobs(record.designJob);
    exportFiles = await exportBlobsToFiles(blobs);
  }
  const payload: QueuedOrderPayload = {
    ...record.customer,
    orderId: record.orderId,
    paymentProof: record.paymentProof,
    exportFiles,
    feedback: record.feedback,
  };
  const submitRecord: QueuedOrderSubmitRecord = {
    id: record.id,
    kind: "submit",
    payload,
    attempts: 0,
    createdAt: record.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => reqToPromise(store.put(submitRecord)));
  return submitRecord;
}

async function processSpecRecord(record: QueuedOrderSpecRecord): Promise<void> {
  if (renderInFlight.has(record.id)) return;
  renderInFlight.add(record.id);
  try {
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        const submitRecord = await upgradeSpecToSubmit(record);
        void processSubmitRecord(submitRecord);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await bumpAttempt(record.id, message).catch(() => {});
        const wait = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 8));
        await delay(wait);
      }
    }
  } finally {
    renderInFlight.delete(record.id);
  }
}

async function processSubmitRecord(
  record: QueuedOrderSubmitRecord,
): Promise<void> {
  if (submitInFlight.has(record.id)) return;
  submitInFlight.add(record.id);
  try {
    let attempt = 0;
    while (true) {
      attempt += 1;
      const result = await postOrder(record.payload);
      if (result.ok) {
        await removeQueuedOrder(record.id).catch(() => {});
        return;
      }
      const message = result.error ?? "Unknown error";
      await bumpAttempt(record.id, message).catch(() => {});
      if (!result.retriable) {
        // 4xx — payload is structurally bad and retrying won't help. Log
        // loudly and drop so the queue doesn't loop forever; the server side
        // also logs the rejected payload for the admin to recover manually.
        // eslint-disable-next-line no-console
        console.error(
          "[order-queue] Order dropped non-retriably:",
          record.payload.orderId,
          message,
        );
        await removeQueuedOrder(record.id).catch(() => {});
        return;
      }
      void registerBackgroundSync();
      const wait = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 8));
      await delay(wait);
    }
  } finally {
    submitInFlight.delete(record.id);
  }
}

/**
 * Foreground submission: save the spec for durability, render the design
 * exports, and POST to /api/create-order — all awaited. Resolves only after
 * the server returns HTTP 200 with an orderId, so the caller can confidently
 * show the success screen. On failure the spec record is left in IndexedDB
 * so the background queue (and Service Worker Background Sync) can keep
 * retrying without losing the order.
 *
 * The server-side outbox still handles file uploads to object storage and
 * the Telegram notification asynchronously after responding, so the customer
 * does not wait for those.
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

  let submitRecord: QueuedOrderSubmitRecord;
  try {
    submitRecord = await upgradeSpecToSubmit(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await bumpAttempt(record.id, message).catch(() => {});
    throw new Error(
      "Could not prepare your design for submission. We've saved your order locally and will retry automatically — please try again.",
    );
  }

  const result = await postOrder(submitRecord.payload);
  if (result.ok) {
    await removeQueuedOrder(submitRecord.id).catch(() => {});
    return { orderId };
  }

  const message = result.error ?? "Unknown error";
  await bumpAttempt(submitRecord.id, message).catch(() => {});

  if (result.retriable) {
    void registerBackgroundSync();
    throw new Error(
      "We couldn't reach the server. Your order is saved on this device and will be sent automatically as soon as you're online — or you can tap Complete Order again now.",
    );
  }

  // Non-retriable (4xx). Drop the record so the background queue does not
  // loop on a structurally bad payload.
  await removeQueuedOrder(submitRecord.id).catch(() => {});
  throw new Error(message);
}

/**
 * Drain the queue: process every pending record. For spec records we render
 * then submit; for submit records we post. Returns immediately — work
 * continues in the background. Safe to call multiple times concurrently.
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
      void processSubmitRecord(record).catch(() => {});
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

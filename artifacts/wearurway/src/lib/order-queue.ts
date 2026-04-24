/**
 * Durable client-side order queue.
 *
 * The full order payload (delivery info + payment proof + design export blobs +
 * feedback) is written to IndexedDB *before* we POST /api/create-order.
 * It only gets removed after the server confirms.
 *
 * If the user closes the page, loses internet, or the request fails partway,
 * we still have the payload sitting in IndexedDB and can resume it:
 *   - On every app boot we call `flushQueuedOrders()` which retries any
 *     unsent payloads in the background.
 *   - When the browser supports Service Worker Background Sync (Android
 *     Chrome, Edge), we register a sync that lets the OS replay the request
 *     even with no tab open.
 */

const DB_NAME = "wearurway-order-queue";
const DB_VERSION = 1;
const STORE = "pending-orders";
const SW_PATH = "/order-sync-sw.js";
const SYNC_TAG = "wearurway-order-sync";

export interface QueuedOrderFile {
  fileName: string;
  dataUrl: string;
}

export interface QueuedOrderPayload {
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
  paymentProof?: QueuedOrderFile;
  exportFiles?: QueuedOrderFile[];
  feedback?: string;
}

export interface QueuedOrderRecord {
  id: string;
  payload: QueuedOrderPayload;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

function makeId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
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

export async function saveQueuedOrder(payload: QueuedOrderPayload): Promise<string> {
  const id = makeId();
  const now = new Date().toISOString();
  const record: QueuedOrderRecord = {
    id,
    payload,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  await withStore("readwrite", (store) => reqToPromise(store.put(record)));
  return id;
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

export async function bumpQueuedOrderAttempt(
  id: string,
  error: string,
): Promise<void> {
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

const inFlight = new Set<string>();

interface SubmitResult {
  ok: boolean;
  orderId?: string;
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
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { orderId?: string }
        | null;
      return { ok: true, orderId: data?.orderId, retriable: false };
    }
    if (res.status >= 500) {
      return { ok: false, error: `Server ${res.status}`, retriable: true };
    }
    // 4xx — payload is bad, no point retrying
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    return { ok: false, error: message, retriable: false };
  } catch (err) {
    // Network / offline / aborted
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

/**
 * Submit a queued order with persistent retry while the page is open.
 * Resolves once the order is accepted by the server (and removed from the
 * queue). Rejects only on a non-retriable error (4xx) — in which case the
 * record is also removed because we cannot retry it usefully.
 *
 * If the page is closed mid-submit the next `flushQueuedOrders()` call (on
 * the next visit) will pick the same record up again.
 */
export async function submitQueuedOrder(id: string): Promise<string> {
  if (inFlight.has(id)) {
    throw new Error("Order is already being submitted");
  }
  inFlight.add(id);
  try {
    const records = await loadQueuedOrders();
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error("Queued order not found");

    let attempt = 0;
    while (true) {
      attempt += 1;
      const result = await postOrder(record.payload);
      if (result.ok && result.orderId) {
        await removeQueuedOrder(id);
        return result.orderId;
      }
      const message = result.error ?? "Unknown error";
      await bumpQueuedOrderAttempt(id, message);
      if (!result.retriable) {
        await removeQueuedOrder(id);
        throw new Error(message);
      }
      // Ask the SW to take over too (so retries continue even if the tab dies)
      void registerBackgroundSync();
      const wait = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 8));
      await delay(wait);
    }
  } finally {
    inFlight.delete(id);
  }
}

/**
 * Drain the queue: kick off a submit for every pending payload that isn't
 * already being processed. Resolves immediately; submissions continue in the
 * background. Safe to call multiple times.
 */
export async function flushQueuedOrders(): Promise<void> {
  let records: QueuedOrderRecord[];
  try {
    records = await loadQueuedOrders();
  } catch {
    return;
  }
  for (const record of records) {
    if (inFlight.has(record.id)) continue;
    void submitQueuedOrder(record.id).catch(() => {
      // Errors are already persisted on the record; the next flush will retry
      // unless the error was non-retriable, in which case the record is gone.
    });
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

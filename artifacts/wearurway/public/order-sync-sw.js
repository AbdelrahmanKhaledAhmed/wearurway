/* eslint-disable no-restricted-globals */
/**
 * Service worker that drains the IndexedDB order queue when the OS triggers
 * a background sync. This lets pending orders go through even if the user
 * closed every browser tab.
 *
 * Supported on Chromium-based browsers (Chrome, Edge, Samsung Internet,
 * Android Chrome). Safari falls back to the in-page retry + next-visit
 * flush implemented in order-queue.ts.
 */

const DB_NAME = "wearurway-order-queue";
const DB_VERSION = 1;
const STORE = "pending-orders";
const SYNC_TAG = "wearurway-order-sync";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(drainQueue());
  }
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "wearurway-flush-orders") {
    event.waitUntil(drainQueue());
  }
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    Promise.resolve(fn(store))
      .then((value) => {
        result = value;
      })
      .catch((err) => {
        try {
          tx.abort();
        } catch (_) {}
        reject(err);
      });
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction aborted"));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction error"));
    };
  });
}

async function loadQueuedOrders() {
  return withStore("readonly", (store) => reqToPromise(store.getAll()));
}

async function removeQueuedOrder(id) {
  return withStore("readwrite", (store) => reqToPromise(store.delete(id)));
}

async function bumpQueuedOrderAttempt(id, error) {
  return withStore("readwrite", async (store) => {
    const existing = await reqToPromise(store.get(id));
    if (!existing) return;
    existing.attempts += 1;
    existing.lastError = error;
    existing.updatedAt = new Date().toISOString();
    await reqToPromise(store.put(existing));
  });
}

async function postOrder(payload) {
  try {
    const res = await fetch("/api/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return { ok: true };
    }
    if (res.status >= 500) {
      return { ok: false, retriable: true, error: `Server ${res.status}` };
    }
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch (_) {}
    return { ok: false, retriable: false, error: message };
  } catch (err) {
    return {
      ok: false,
      retriable: true,
      error: err && err.message ? err.message : String(err),
    };
  }
}

async function drainQueue() {
  let records;
  try {
    records = await loadQueuedOrders();
  } catch (_) {
    return;
  }
  for (const record of records) {
    const result = await postOrder(record.payload);
    if (result.ok) {
      try {
        await removeQueuedOrder(record.id);
      } catch (_) {}
      continue;
    }
    try {
      await bumpQueuedOrderAttempt(record.id, result.error || "unknown");
    } catch (_) {}
    if (!result.retriable) {
      try {
        await removeQueuedOrder(record.id);
      } catch (_) {}
      continue;
    }
    // Throw so the browser reschedules this sync with backoff.
    throw new Error(result.error || "Retriable error");
  }
}

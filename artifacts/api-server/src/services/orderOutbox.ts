import { getStore, updateStore, type OrderFileRecord } from "../data/store.js";
import { uploadBuffer } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";
import { renderDesignFiles, type DesignJobInput } from "./designRenderer.js";

export interface PendingUploadEntry {
  id: string;
  fileName: string;
  contentType: string;
  dataBase64: string;
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
}

export interface PendingNotificationEntry {
  payload: NotificationPayload;
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
}

export interface NotificationPayload {
  name?: string;
  phone?: string;
  address?: string;
  product?: string;
  fit?: string;
  color?: string;
  size?: { name?: string; realWidth?: number; realHeight?: number };
  paymentMethod?: "cod" | "instapay";
  productPrice?: number;
  shippingPrice?: number;
  total?: number;
  feedback?: string;
}

const TICK_INTERVAL_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 500;

const inFlightOrders = new Set<string>();
let timer: NodeJS.Timeout | null = null;

function nextBackoff(attempts: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempts, 10));
  const jitter = Math.floor(Math.random() * 250);
  return Date.now() + exp + jitter;
}

function makeUploadId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function gcsOrderKey(orderId: string, fileName: string): string {
  return `orders/${orderId}/${fileName}`;
}

function readRecord(orderId: string): OrderFileRecord | undefined {
  return getStore().orderFiles[orderId];
}

export function enqueueUploads(
  orderId: string,
  files: { fileName: string; contentType: string; buffer: Buffer }[],
): void {
  if (files.length === 0) return;
  updateStore((store) => {
    const record = store.orderFiles[orderId];
    if (!record) return;
    const queue = record.pendingUploads ?? [];
    for (const file of files) {
      queue.push({
        id: makeUploadId(),
        fileName: file.fileName,
        contentType: file.contentType,
        dataBase64: file.buffer.toString("base64"),
        attempts: 0,
        nextAttemptAt: Date.now(),
      });
    }
    record.pendingUploads = queue;
    record.updatedAt = new Date().toISOString();
  });
  scheduleProcess(orderId);
}

export function enqueueNotification(orderId: string, payload: NotificationPayload): void {
  updateStore((store) => {
    const record = store.orderFiles[orderId];
    if (!record) return;
    record.pendingNotification = {
      payload,
      attempts: 0,
      nextAttemptAt: Date.now(),
    };
    record.notificationSentAt = undefined;
    record.updatedAt = new Date().toISOString();
  });
  scheduleProcess(orderId);
}

/**
 * Queue a server-side design render. The renderer turns the (small) design
 * spec into 4 PNGs and enqueues each one as a regular pendingUpload — the
 * notification is held until that whole chain drains.
 */
export function enqueueDesignRender(orderId: string, designJob: DesignJobInput): void {
  updateStore((store) => {
    const record = store.orderFiles[orderId];
    if (!record) return;
    record.pendingDesignRender = {
      designJob,
      attempts: 0,
      nextAttemptAt: Date.now(),
    };
    record.updatedAt = new Date().toISOString();
  });
  scheduleProcess(orderId);
}

function scheduleProcess(orderId: string): void {
  setImmediate(() => {
    void processOrder(orderId);
  });
}

async function processOrder(orderId: string): Promise<void> {
  if (inFlightOrders.has(orderId)) return;
  const record = readRecord(orderId);
  if (!record) return;
  if (
    (!record.pendingUploads || record.pendingUploads.length === 0) &&
    !record.pendingNotification &&
    !record.pendingDesignRender
  ) {
    return;
  }

  inFlightOrders.add(orderId);
  try {
    await drainDesignRender(orderId);
    await drainUploads(orderId);
    await drainNotification(orderId);
  } finally {
    inFlightOrders.delete(orderId);
  }
}

async function drainDesignRender(orderId: string): Promise<void> {
  while (true) {
    const record = readRecord(orderId);
    if (!record) return;
    const pending = record.pendingDesignRender;
    if (!pending) return;

    const now = Date.now();
    if (pending.nextAttemptAt > now) {
      await sleep(Math.min(pending.nextAttemptAt - now, MAX_BACKOFF_MS));
      continue;
    }

    try {
      const files = await renderDesignFiles(pending.designJob);
      // Atomically: enqueue rendered files for upload, clear render queue.
      updateStore((store) => {
        const r = store.orderFiles[orderId];
        if (!r) return;
        const queue = r.pendingUploads ?? [];
        for (const file of files) {
          queue.push({
            id: makeUploadId(),
            fileName: file.fileName,
            contentType: file.contentType,
            dataBase64: file.buffer.toString("base64"),
            attempts: 0,
            nextAttemptAt: Date.now(),
          });
        }
        r.pendingUploads = queue;
        r.pendingDesignRender = undefined;
        r.updatedAt = new Date().toISOString();
      });
      logger.info(
        { orderId, fileCount: files.length, attempts: pending.attempts + 1 },
        "Order design files rendered server-side",
      );
      return;
    } catch (err) {
      const attempts = pending.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      updateStore((store) => {
        const r = store.orderFiles[orderId];
        if (!r || !r.pendingDesignRender) return;
        r.pendingDesignRender.attempts = attempts;
        r.pendingDesignRender.lastError = message;
        r.pendingDesignRender.nextAttemptAt = nextBackoff(attempts);
        r.updatedAt = new Date().toISOString();
      });
      logger.warn(
        { orderId, attempts, err: message },
        "Order design render failed — will retry",
      );
      const wait = Math.max(50, nextBackoff(attempts) - Date.now());
      await sleep(Math.min(wait, MAX_BACKOFF_MS));
    }
  }
}

async function drainUploads(orderId: string): Promise<void> {
  while (true) {
    const record = readRecord(orderId);
    if (!record) return;
    const queue = record.pendingUploads ?? [];
    if (queue.length === 0) return;

    const now = Date.now();
    const due = queue.find((entry) => entry.nextAttemptAt <= now);
    if (!due) {
      const earliest = queue.reduce(
        (min, e) => Math.min(min, e.nextAttemptAt),
        Number.POSITIVE_INFINITY,
      );
      const wait = Math.max(50, earliest - Date.now());
      await sleep(Math.min(wait, MAX_BACKOFF_MS));
      continue;
    }

    try {
      const buffer = Buffer.from(due.dataBase64, "base64");
      await uploadBuffer(gcsOrderKey(orderId, due.fileName), buffer, due.contentType);
      updateStore((store) => {
        const r = store.orderFiles[orderId];
        if (!r) return;
        r.pendingUploads = (r.pendingUploads ?? []).filter((e) => e.id !== due.id);
        const existingFiles = new Set(r.files ?? []);
        existingFiles.add(due.fileName);
        r.files = Array.from(existingFiles);
        r.updatedAt = new Date().toISOString();
      });
      logger.info(
        { orderId, fileName: due.fileName, attempts: due.attempts + 1 },
        "Order file uploaded",
      );
    } catch (err) {
      const attempts = due.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      updateStore((store) => {
        const r = store.orderFiles[orderId];
        if (!r) return;
        const entry = (r.pendingUploads ?? []).find((e) => e.id === due.id);
        if (entry) {
          entry.attempts = attempts;
          entry.lastError = message;
          entry.nextAttemptAt = nextBackoff(attempts);
        }
        r.updatedAt = new Date().toISOString();
      });
      logger.warn(
        { orderId, fileName: due.fileName, attempts, err: message },
        "Order file upload failed — will retry",
      );
      const wait = Math.max(50, nextBackoff(attempts) - Date.now());
      await sleep(Math.min(wait, MAX_BACKOFF_MS));
    }
  }
}



async function drainNotification(orderId: string): Promise<void> {
  while (true) {
    const record = readRecord(orderId);
    if (!record) return;
    if (record.pendingDesignRender) return;
    if (record.pendingUploads && record.pendingUploads.length > 0) return;
    const pending = record.pendingNotification;
    if (!pending) return;

    const now = Date.now();
    if (pending.nextAttemptAt > now) {
      await sleep(Math.min(pending.nextAttemptAt - now, MAX_BACKOFF_MS));
      continue;
    }

    try {
      await sendTelegramMessage(orderId, pending.payload);
      updateStore((store) => {
        const r = store.orderFiles[orderId];
        if (!r) return;
        r.pendingNotification = undefined;
        r.notificationSentAt = new Date().toISOString();
        r.updatedAt = new Date().toISOString();
      });
      logger.info(
        { orderId, attempts: pending.attempts + 1 },
        "Order Telegram notification sent",
      );
      return;
    } catch (err) {
      const attempts = pending.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      updateStore((store) => {
        const r = store.orderFiles[orderId];
        if (!r || !r.pendingNotification) return;
        r.pendingNotification.attempts = attempts;
        r.pendingNotification.lastError = message;
        r.pendingNotification.nextAttemptAt = nextBackoff(attempts);
        r.updatedAt = new Date().toISOString();
      });
      logger.warn(
        { orderId, attempts, err: message },
        "Order Telegram notification failed — will retry",
      );
      const wait = Math.max(50, nextBackoff(attempts) - Date.now());
      await sleep(Math.min(wait, MAX_BACKOFF_MS));
    }
  }
}

async function sendTelegramMessage(orderId: string, payload: NotificationPayload): Promise<void> {
  const settings = getStore().orderSettings;
  const botToken = settings.telegramBotToken;
  const chatId = settings.telegramChatId;

  if (!botToken || !chatId) {
    throw new Error(
      "Telegram bot token or chat ID is not configured — set them in admin → order settings",
    );
  }
  
function padLabel(label: string, width: number): string {
  return label.padEnd(width, " ");
}  

  const paymentMethod =
    payload.paymentMethod === "instapay" ? "InstaPay 💳" : "Cash on Delivery 💵";
  const productPrice =
    payload.productPrice ??
    Math.max(0, (payload.total ?? 0) - (payload.shippingPrice ?? 0));
  const shippingPrice =
    payload.shippingPrice ?? Math.max(0, (payload.total ?? 0) - productPrice);
  const sizeDetails = `${payload.size?.name ?? "-"} (${payload.size?.realWidth ?? "-"} × ${payload.size?.realHeight ?? "-"} cm)`;
  const line = "━━━━━━━━━━━━━━━";
  const trimmedFeedback = payload.feedback?.trim();
  const message = [
  line,
  "NEW ORDER",
  line,
  "",
  `Order ID: ${orderId}`,
  "",
  "CUSTOMER INFO",
  `${padLabel("Name:", 12)} ${payload.name ?? "-"}`,
  `${padLabel("Phone:", 12)} ${payload.phone ?? "-"}`,
  `${padLabel("Address:", 12)} ${payload.address ?? "-"}`,
  "",
  "PRODUCT DETAILS",
  `${padLabel("Product:", 12)} ${payload.product ?? "-"}`,
  `${padLabel("Fit:", 12)} ${payload.fit ?? "-"}`,
  `${padLabel("Color:", 12)} ${payload.color ?? "-"}`,
  `${padLabel("Size:", 12)} ${sizeDetails}`,
  "",
  "PRICING",
  `${padLabel("T-shirt:", 12)} ${formatMoney(productPrice)}`,
  `${padLabel("Shipping:", 12)} ${formatMoney(shippingPrice)}`,
  `${padLabel("Total:", 12)} ${formatMoney(payload.total)}`,
  "",
  `${padLabel("Payment:", 12)} ${paymentMethod}`,
  "",
  ...(trimmedFeedback ? ["CUSTOMER FEEDBACK", trimmedFeedback, ""] : []),
  line,
].join("\n");

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      body: new URLSearchParams({ chat_id: chatId, text: message }),
    },
  );
  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; description?: string }
    | null;
  if (!response.ok || !data?.ok) {
    const description = data?.description ? `: ${data.description}` : "";
    throw new Error(`Telegram request failed${description}`);
  }
}

function formatMoney(value: number | undefined): string {
  return `${Number(value ?? 0)} EGP`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tick(): void {
  const orderFiles = getStore().orderFiles;
  for (const [orderId, record] of Object.entries(orderFiles)) {
    const hasUploads = record.pendingUploads && record.pendingUploads.length > 0;
    const hasNotification = !!record.pendingNotification;
    const hasRender = !!record.pendingDesignRender;
    if (hasUploads || hasNotification || hasRender) {
      scheduleProcess(orderId);
    }
  }
}

export function startOrderOutbox(): void {
  if (timer) return;
  tick();
  timer = setInterval(tick, TICK_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info("Order outbox worker started");
}

export function stopOrderOutbox(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
